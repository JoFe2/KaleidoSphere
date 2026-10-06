// Current H282 registration only; preserve historical proof and predecessor bytes.
import {createHash} from 'node:crypto';import {readFile,writeFile,rename} from 'node:fs/promises';
const authored=[
  "scripts/hosting/run-native-host-epic.py",
  "scripts/hosting/native-host-epic-browser.mjs",
  "scripts/hosting/native-host-epic-owner.py",
  "scripts/hosting/host-epic-native-owner-probe.mjs",
  "scripts/hosting/host-epic-native-budget-request.mjs",
  "scripts/hosting/host-epic-native-receipt.mjs",
  "tests/h282-host-epic-native-binding.test.mjs",
  "tests/h282-host-epic-budget-request.test.mjs",
  "tests/fixtures/h282-actual-native-development-observation.json",
  "docs/hosting/ks282/README.md",
  "scripts/update-h282-source-map.mjs",
  "tests/source-map.test.mjs",
  "tests/canonical-test-topology.test.mjs",
  "docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json"
];
const protectedPins={
  "package.json": "85ca0ccac0fa41d937e2ce62768bff6b1cfe3b2ec3d04886343fcd905646c401",
  ".github/workflows/ci.yml": "3c8aac32f3711ad05330947025e60146c242539bd5cb92278ffb16830bd8be86",
  "services/bi-agent/src/server.mjs": "6cc0cef11f77ae30839825805c02e4b679fb476bbf694885bfef56c97530b384",
  "services/bi-agent/src/browser-starter-page.mjs": "02e32a77b65b57f05c65af739a6c780844c68b5724f9c7879f50277f7940e5b7",
  "services/bi-control/src/server.mjs": "266677847b72ea28983443ca3e669b1bf61492bb754f5f70f99969b45e7a24bb",
  "services/bi-control/src/hosting/browser-starter.mjs": "c0c2b46e8162e4a7851ca2c2d03a66bc1ad638566f60e7a172bc8bb6badacba1",
  "services/bi-control/src/hosting/browser-starter-store.mjs": "d22026535e4cbe1b1a3f77208a9a1040b9c303c8722c0a5a086121e9422db33b",
  "services/bi-control/src/hosting/origin-session-ingress.mjs": "87ef088880d0a8bcd5d3cdcb257b6fedede96e5aac13953155efd8253c533028",
  "services/bi-control/src/runtime/pan-origin-source.mjs": "66c22d65f375e2e0bc9e67c323e0d2ccd64db7adc5e5e5415d7b2c4e6f898a81",
  "services/bi-control/src/hosting/portable-runtime.mjs": "e81f3154f3643ca980a58ebaab35280f8202a2c6b670b7ef270765c6a82eb26b",
  "services/bi-control/src/hosting/portable-runtime-lifecycle.mjs": "635b09530791c56860c4a7a6e150f41911840596bd6c5bb9bc031992d42b3e29",
  "services/bi-control/src/runtime/h05-native-broker-runtime.mjs": "d3c487e7cfd127d47a78f58dded78dd29cb29495aa2f6f19a6052eda43aba7b7"
};
for(const [name,expected] of Object.entries(protectedPins))if(createHash('sha256').update(await readFile(name)).digest('hex')!==expected)throw new Error('H282_PROTECTED_PREDECESSOR_CHANGED');
const map=JSON.parse(await readFile('SOURCE-MAP.json','utf8'));
for(const name of authored)map.files[name]=createHash('sha256').update(await readFile(name)).digest('hex');
map.files=Object.fromEntries(Object.entries(map.files).sort(([a],[b])=>a.localeCompare(b)));
const pending=`SOURCE-MAP.json.ks282-${process.pid}.tmp`;await writeFile(pending,JSON.stringify(map,null,2)+'\n',{flag:'wx'});await rename(pending,'SOURCE-MAP.json');
console.log(JSON.stringify({authoredFiles:authored.length,totalEntries:Object.keys(map.files).length,historicalEvidenceReminted:false,protectedPredecessorsModified:false,packageCommandModified:false}));
