import datetime, hashlib, json, os, pathlib, secrets, socket, subprocess, time, uuid, shutil, tempfile, re

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRATCH = pathlib.Path(os.environ.get('TMPDIR', tempfile.gettempdir())).resolve()
EVIDENCE_ROOT = pathlib.Path(os.environ.get('KS293_EVIDENCE_ROOT', str(REPO / 'dist/h02-evidence'))).resolve()
BROWSER = REPO / 'scripts/hosting/native-protected-browser.mjs'
BROWSER_WORKSPACE = pathlib.Path(os.environ.get('KS293_BROWSER_WORKSPACE', str(REPO / 'dependencies/ks293-browser-runtime'))).resolve()
CERTUTIL = os.environ.get('KS293_CERTUTIL') or shutil.which('certutil')
FIREFOX = os.environ.get('KS293_FIREFOX', '/usr/bin/firefox')
SESSION_SOURCE = os.environ.get('KS293_PAN527_SESSION_SOURCE')
if not SESSION_SOURCE or not CERTUTIL or not pathlib.Path(FIREFOX).is_file():
    raise RuntimeError('Required exact PAN v3 source, certutil and Firefox are not configured')
if not SCRATCH.is_dir() or not (BROWSER_WORKSPACE / 'node_modules/puppeteer-core/package.json').is_file():
    raise RuntimeError('Required owned scratch and locked Puppeteer runtime are not available')
PREFIX = 'ks293protected' + uuid.uuid4().hex[:12]
OUT = EVIDENCE_ROOT / PREFIX
OUT.mkdir(parents=True, mode=0o700)
STATE = SCRATCH / (PREFIX + '-owned-state')
STATE.mkdir(mode=0o700)
IMAGES = {'agent': os.environ.get('KS293_AGENT_IMAGE', 'sha256:8d36d93aa4c04bd1578432744df073a8d7963c415f628d79013cf32df25ed386'),
          'control': os.environ.get('KS293_CONTROL_IMAGE', 'sha256:0aec85f2f1d0b8446f107b798d7826633b0c580cec5d6d13df02be20d33cc472')}
if not all(re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in IMAGES.values()):
    raise RuntimeError('An image identity must be an exact explicit SHA256, never a repaired token or tag')
containers = []
networks = []
started = datetime.datetime.now(datetime.timezone.utc).isoformat()

def run(args, timeout=40):
    r = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(json.dumps({'command': args, 'exit': r.returncode, 'stdout': r.stdout, 'stderr': r.stderr}))
    return r.stdout.strip()

def inspect(container):
    data = json.loads(run(['docker', 'inspect', container]))[0]
    assert data['Id'] == container
    assert data['Config']['Labels']['ks.owner'] == PREFIX
    assert data['Config']['Labels']['ks.issue'] == '293'
    return data

receipt = {'scope': 'pinned PAN v3 protected KS control-route session, verified TLS, native browser development integration; existing image plus read-only agent overlay, not release/delivery or real-model acceptance',
           'prefix': PREFIX, 'startedAtUtc': started, 'images': IMAGES, 'taskPrivateUser': f'{os.getuid()}:{os.getgid()}',
           'imageDefaultUserNotRelabelled': '10001:10001; explicitly overridden only inside owned test containers',
           'commonRuntimeIdentityEnumUnchanged': ['pansphaira-local-demo', 'kaleidosphere-bi-agent'],
           'noNewControlIdentityClaimed': True, 'externalOIDCOrPortalUsed': False}
try:
    origins = {}
    for tenant in ['tenant-a', 'tenant-b']:
        root = STATE / tenant
        root.mkdir(mode=0o700)
        (root / 'receipts').mkdir(mode=0o700)
        (root / 'projection').mkdir(mode=0o700)
        (root / 'sessions').mkdir(mode=0o700)
        token = root / 'control-auth'
        token.write_text(secrets.token_hex(32))
        token.chmod(0o600)
        net = run(['docker', 'network', 'create', '--label', 'ks.issue=293', '--label', 'ks.owner=' + PREFIX,
                   PREFIX + '-' + tenant])
        networks.append(net)
        common = ['--detach', '--read-only', '--user', f'{os.getuid()}:{os.getgid()}', '--memory', '512m', '--cpus', '1',
                  '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                  '--network', net, '--label', 'ks.issue=293', '--label', 'ks.owner=' + PREFIX, '--label', 'ks.tenant=' + tenant,
                  '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m', '--mount', f'type=bind,src={token},dst=/run/secrets/control-auth,readonly',
                  '--env', 'CONTROL_TOKEN_FILE=/run/secrets/control-auth']
        control = run(['docker', 'run', '--name', PREFIX + '-' + tenant + '-control', '--network-alias', 'bi-control',
                       *common, '--mount', f'type=bind,src={root / "receipts"},dst=/task/receipts',
                       '--mount', f'type=bind,src={root / "projection"},dst=/task/projection',
                       '--env', 'RECEIPT_DIR=/task/receipts', '--env', 'PROJECTION_DB=/task/projection/analytics.db',
                       '--env', 'BI_SOURCE_MODE=fixture', '--env', 'BI_ENGINE=mssql', IMAGES['control']])
        containers.append(control)
        agent = run(['docker', 'run', '--name', PREFIX + '-' + tenant + '-agent', *common,
                     '--mount', f'type=bind,src={REPO / "services/bi-agent/src/server.mjs"},dst=/app/src/server.mjs,readonly',
                     '--env', 'AGENT_ROUTE_PREFIX=/t/' + tenant,
                     '--publish', '127.0.0.1::18790', '--env', 'CONTROL_BASE_URL=http://bi-control:18089',
                     '--env', 'LLM_MODE=stub', IMAGES['agent']])
        containers.append(agent)
        data = inspect(agent)
        assert data['Image'] == IMAGES['agent']
        exposed = data['NetworkSettings']['Ports']['18790/tcp']
        assert len(exposed) == 1 and exposed[0]['HostIp'] == '127.0.0.1'
        origins[tenant] = 'http://127.0.0.1:' + exposed[0]['HostPort']
    import requests
    for tenant, origin in origins.items():
        for trial in range(100):
            try:
                r = requests.get(origin + '/t/' + tenant + '/healthz', timeout=2)
                if r.status_code == 200 and r.json() == {'status': 'ok'}:
                    break
            except requests.RequestException:
                pass
            time.sleep(0.05)
        else:
            raise AssertionError('Native agent readiness was not acquired for ' + tenant)
    actuals = []
    for cid in containers:
        data = inspect(cid)
        version = run(['docker', 'exec', cid, 'node', '--version'])
        source_read = json.loads(run(['docker', 'exec', cid, 'node', '--input-type=module', '-e',
            "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';console.log(JSON.stringify({sha256:createHash('sha256').update(readFileSync('src/server.mjs')).digest('hex')}))"]))
        assert version == 'v24.14.0'
        if cid in containers[1::2]:
            assert source_read['sha256'] == hashlib.sha256((REPO / 'services/bi-agent/src/server.mjs').read_bytes()).hexdigest()
        actuals.append({'containerId': cid, 'imageId': data['Image'], 'name': data['Name'], 'node': version,
                        'sourceSha256': source_read['sha256'], 'state': data['State']['Status'], 'networks': list(data['NetworkSettings']['Networks'])})
    receipt['actualNativeProcesses'] = actuals
    for cid in containers[1::2]:
        mounts = [m for m in inspect(cid)['Mounts'] if m['Destination'] == '/app/src/server.mjs']
        assert len(mounts) == 1 and not mounts[0]['RW']
        assert mounts[0]['Source'] == str(REPO / 'services/bi-agent/src/server.mjs')
    key_path, cert_path = STATE / 'tls.key', STATE / 'tls.crt'
    ca_key, ca_path, csr_path = STATE / 'ca.key', STATE / 'ca.crt', STATE / 'tls.csr'
    run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(ca_key), '-out', str(ca_path), '-days', '1', '-subj', '/CN=ks293-owned-test-CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
    run(['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key_path), '-out', str(csr_path), '-subj', '/CN=ks293.test'])
    extensions = STATE / 'leaf-extensions.cnf'
    extensions.write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:ks293.test\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    run(['openssl', 'x509', '-req', '-in', str(csr_path), '-CA', str(ca_path), '-CAkey', str(ca_key), '-set_serial', '1', '-out', str(cert_path), '-days', '1', '-sha256', '-extfile', str(extensions)])
    for file in [ca_key, ca_path, key_path, cert_path, csr_path, extensions]:
        file.chmod(0o600)
    verified_leaf = run(['openssl', 'verify', '-CAfile', str(ca_path), '-purpose', 'sslserver', '-verify_ip', '127.0.0.1', str(cert_path)])
    assert verified_leaf == str(cert_path) + ': OK'
    receipt['isolatedCertificateChain'] = {'leafSha256': hashlib.sha256(cert_path.read_bytes()).hexdigest(), 'caSha256': hashlib.sha256(ca_path.read_bytes()).hexdigest(), 'verifiedPurpose': 'sslserver', 'verifiedIP': '127.0.0.1', 'systemTrustChanged': False}
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0)); https_port = reservation.getsockname()[1]
    base_commit = '67c611c6b523d8d8ee329a65f8a00a589de81e1e'
    # Explicit accepted baseline-image scope, not a claim that the overlay was
    # rebuilt into this image. These pins are checked against actual native bytes.
    base_tree = 'c36229b762bac232eb5cc942c9d68272076ee46c'
    control_sha = '8b4e3bed4aec797dd4d556148c48530736fe991fa25cfaae1412c8b97319eda1'
    tenants = []
    for tenant, actual in zip(['tenant-a', 'tenant-b'], actuals[::2]):
        assert actual['sourceSha256'] == control_sha
        assert inspect(actual['containerId'])['Config']['Labels']['ks.tenant'] == tenant
        # A raw Docker ID is preserved verbatim in observations; it is not a
        # producer ScopeId when its first byte is numeric. Use the separate
        # exact operator-created native instance name, not a repaired ID.
        owned_instance_name = PREFIX + '-' + tenant + '-control'
        assert actual['name'] == '/' + owned_instance_name
        route_binding = {'schemaVersion': 'pansphaira.hosted-origin-session/protected-route-binding/v1', 'componentId': 'kaleidosphere-bi-control',
            'entrypointPath': 'services/bi-control/src/server.mjs', 'sourceCommit': base_commit, 'sourceTree': base_tree,
            'entrypointSha256': control_sha, 'runtime': {'name': 'node', 'version': actual['node'].lstrip('v')},
            'instanceId': owned_instance_name, 'tenantId': tenant, 'generation': 1}
        tenants.append({'routeBinding': route_binding, 'stateRoot': str(STATE / tenant / 'sessions'), 'agentOrigin': origins[tenant]})
    cfg = {'repo': str(REPO), 'sessionSource': SESSION_SOURCE, 'browserWorkspace': str(BROWSER_WORKSPACE), 'firefoxPath': FIREFOX,
           'certutil': CERTUTIL,
           'httpsOrigin': 'https://127.0.0.1:' + str(https_port), 'caPath': str(ca_path), 'tls': {'keyPath': str(key_path), 'certPath': str(cert_path)},
           'tenants': tenants, 'output': str(OUT)}
    receipt['protectedNativeBindings'] = [spec['routeBinding'] for spec in tenants]
    receipt['generationBasis'] = 'Owned native process start epoch 1, distinct from analysis-generation digest; exact owner-created instance name independently read back, raw Docker ID preserved separately, entrypoint bytes acquired'

    config = OUT / 'browser-input.json'
    config.write_text(json.dumps(cfg, indent=2) + '\n')
    browser_bytes = BROWSER.read_bytes()
    browser_sha = hashlib.sha256(browser_bytes).hexdigest()
    sealed_browser = OUT / ('native-protected-' + browser_sha + '.mjs')
    if not sealed_browser.exists():
        with sealed_browser.open('xb') as held:
            held.write(browser_bytes)
        sealed_browser.chmod(0o400)
    assert sealed_browser.read_bytes() == browser_bytes
    product_paths = ['services/bi-agent/src/server.mjs', 'services/bi-agent/src/hosted-route-policy.mjs',
                     'services/bi-control/src/runtime/pan-origin-source.mjs', 'services/bi-control/src/hosting/origin-session-ingress.mjs',
                     'contracts/dependencies/pan527-origin-session-source-development-v3.json']
    product_pins = {name: hashlib.sha256((REPO / name).read_bytes()).hexdigest() for name in product_paths}
    receipt['browserHarness'] = {'path': str(sealed_browser), 'sha256': browser_sha, 'immutableRecipe': True}
    receipt['productSourcePins'] = product_pins
    r = subprocess.run(['node', str(sealed_browser), str(config)], text=True, capture_output=True, timeout=360)
    assert product_pins == {name: hashlib.sha256((REPO / name).read_bytes()).hexdigest() for name in product_paths}
    (OUT / 'browser.stdout').write_text(r.stdout)
    (OUT / 'browser.stderr').write_text(r.stderr)
    receipt['browserExit'] = r.returncode
    if r.returncode:
        raise RuntimeError('Actual browser probe failed: ' + r.stderr)
    browser = json.loads((OUT / 'native-protected-browser-receipt.json').read_text())
    assert browser['fail'] == 0 and browser['skipped'] == 0 and browser['pass'] == browser['tests']
    assert browser['tests'] == len(browser['cases']) and browser['tests'] > 0
    required = {'actual-verified-TLS-native-page-and-producer-cookie-response', 'actual-certificate-verifying-browser-native-page-cookie', 'actual-native-prefixed-click-CSRF-status-two-tenants', 'actual-existing-browser-analysis-and-native-readback', 'actual-browser-missing-invalid-CSRF-and-role-spoof-denied', 'actual-verified-TLS-WebSocket-upgrade-denied', 'actual-auth-key-outage-fail-closed-no-portal-fallback', 'actual-browser-cookie-and-persisted-session-expiry-denied'}
    assert required.issubset({case['id'] for case in browser['cases']})
    # Real products must have distinct persisted roots: only A was analyzed.
    active_a = STATE / 'tenant-a/receipts/.ks254-generations/active'
    active_b = STATE / 'tenant-b/receipts/.ks254-generations/active'
    assert active_a.is_symlink()
    assert not active_b.exists() and not active_b.is_symlink()
    analysis_case = next(case for case in browser['cases'] if case['id'] == 'actual-existing-browser-analysis-and-native-readback')
    generation = analysis_case['value']['readback']['generationId']
    assert len(generation) == 64 and all(ch in '0123456789abcdef' for ch in generation)
    assert os.readlink(active_a) == 'generations/' + generation
    stored = json.loads((active_a / 'receipt.json').read_text())
    assert stored['receiptId'] == analysis_case['value']['analysisReceipt']['receiptId']
    persisted = {'generationId': generation, 'activeRelativeTarget': os.readlink(active_a),
                 'receiptIdMatchesBrowser': stored['receiptId'] == analysis_case['value']['analysisReceipt']['receiptId'],
                 'nativeReceipt': stored, 'nativeReceiptSha256': hashlib.sha256((active_a / 'receipt.json').read_bytes()).hexdigest(),
                 'tenantBActiveGenerationAbsent': not active_b.exists() and not active_b.is_symlink()}
    (OUT / 'native-generation-readback.json').write_text(json.dumps(persisted, indent=2) + '\n')
    receipt['actualNativeGeneration'] = generation
    receipt.update({'status': 'PASS_DEVELOPMENT_NATIVE_PROTECTED_V3_SCOPE', 'browserTests': browser['tests'],
                    'browserPass': browser['pass'], 'browserFail': 0, 'browserSkipped': 0,
                    'actualDistinctOwnedPersistence': True, 'currentAgentSourceByteMatchingMountedOverlay': True, 'unalteredBaseImageUsed': True})
    print(r.stdout)
except Exception as error:
    receipt['status'] = 'FAIL_PRESERVED'
    receipt['error'] = str(error)
    raise
finally:
    for cid in containers:
        data = inspect(cid)
        logs = subprocess.run(['docker', 'logs', cid], text=True, capture_output=True, timeout=20)
        (OUT / (data['Name'].lstrip('/') + '.stdout')).write_text(logs.stdout)
        (OUT / (data['Name'].lstrip('/') + '.stderr')).write_text(logs.stderr)
        run(['docker', 'rm', '--force', cid])
    for net in networks:
        data = json.loads(run(['docker', 'network', 'inspect', net]))[0]
        assert data['Id'] == net and data['Labels']['ks.owner'] == PREFIX and data['Labels']['ks.issue'] == '293'
        run(['docker', 'network', 'rm', net])
    remain = run(['docker', 'ps', '-a', '--filter', 'label=ks.owner=' + PREFIX, '--format', '{{.ID}}'])
    remain_net = run(['docker', 'network', 'ls', '--filter', 'label=ks.owner=' + PREFIX, '--format', '{{.ID}}'])
    assert not remain and not remain_net
    receipt['cleanup'] = {'remainingOwnedContainers': 0, 'remainingOwnedNetworks': 0, 'exactOwnerReadback': True}
    shutil.rmtree(STATE)
    assert not STATE.exists()
    receipt['ownedTransientStateRemoved'] = True
    receipt['endedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (OUT / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'status': receipt['status'], 'evidence': str(OUT), 'cleanup': receipt['cleanup']}, indent=2))
