import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {loadH01PanRuntimeSourceV1,releaseH01PanRuntimeSourceV1} from './pan-runtime-source.mjs';
import {captureH01LocalRuntimeContextV1} from './local-runtime-context.mjs';
import { readLocalObservedWireJson } from '../../../../scripts/lib/h01-local-wire-data.mjs';
import { readH01CapturedRuntimeIdentityV1 } from './local-runtime-context.mjs';
import { getH05SharedRuntimeApisV1 } from './h05-shared-runtime-source.mjs';
const templates = new WeakMap();
const denied = () => { throw new Error('H05_TEMPLATE_CONTEXT_DENIED'); };

// Reuse the actual owner-held H01 context and unchanged shared template
// contract. This captures planning metadata only: no new observation, source
// registration, runtime/image qualification, activation or execution grant.
export function captureH05ServerRuntimeTemplateV1(source, localOwnerContext) {
  const { identity } = readH01CapturedRuntimeIdentityV1(localOwnerContext);
  const api = getH05SharedRuntimeApisV1(source);
  const template = api.templates.bindRuntimeTemplateV1(identity);
  const handle = Object.freeze({});
  templates.set(handle, { source, localOwnerContext, runtimeTemplateDigest: template.runtimeTemplateDigest });
  return handle;
}
function heldTemplate(handle) {
  const held = templates.get(handle); if (!held) denied();
  const { identity } = readH01CapturedRuntimeIdentityV1(held.localOwnerContext);
  const api = getH05SharedRuntimeApisV1(held.source);
  const template = api.templates.bindRuntimeTemplateV1(identity);
  if (template.runtimeTemplateDigest !== held.runtimeTemplateDigest) denied();
  return { identity, api, template };
}
export function readH05ServerRuntimeTemplateV1(handle) {
  return heldTemplate(handle).template;
}
// A caller selects only the held server template. Rights/policy/network,
// components, resource classes, commands, endpoints and SQL remain owner data;
// the existing common closed request parser decides, not a KS shadow schema.
export function planH05ClosedRuntimeTemplateV1(handle, value, currentTemplateDigest = null) {
  const { identity, api } = heldTemplate(handle);
  return api.templates.planRuntimeTemplateV1(readLocalObservedWireJson(value), identity, currentTemplateDigest);
}

// Explicit offline owner metadata channel, not an observation/READY or grant.
// It is never selected by agent input and contains references, never secrets.
export async function loadH05OwnedServerTemplateV1(source, sourceRoot, ownerRoot) {
  let directory, file, legacy;
  try {
    directory = openSync(ownerRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const dir = fstatSync(directory);
    if (typeof process.getuid !== 'function' || dir.uid !== process.getuid() || (dir.mode & 0o077) !== 0) denied();
    file = openSync('/proc/self/fd/' + directory + '/operator-held-context.json', constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > 262144) denied();
    const bytes = Buffer.alloc(stat.size + 1); let offset = 0;
    while (offset < bytes.length) { const count = readSync(file, bytes, offset, bytes.length - offset, null); if (!count) break; offset += count; }
    if (offset !== stat.size) denied();
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)));
    legacy = await loadH01PanRuntimeSourceV1(sourceRoot);
    const local = captureH01LocalRuntimeContextV1(legacy, value);
    const templateContext = captureH05ServerRuntimeTemplateV1(source, local);
    return Object.freeze({ templateContext, release: () => releaseH01PanRuntimeSourceV1(legacy) });
  } catch (error) {
    if (legacy) releaseH01PanRuntimeSourceV1(legacy);
    throw error;
  } finally { if (file !== undefined) closeSync(file); if (directory !== undefined) closeSync(directory); }
}
