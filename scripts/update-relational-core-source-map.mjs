// K06 bounded current-source map migration. Preserve all historical proof bytes.
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
const authored=[
 '.github/workflows/ci.yml','.gitignore',
 'contracts/dependencies/relational-core-worker-lock-v1.json',
 'docs/evidence/relational-core-worker-v1.md',
 'docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json',
 'scripts/prepare-relational-core-native-fixture.py','scripts/provision-relational-core-runtime.py',
 'scripts/update-relational-core-source-map.mjs',
 'services/bi-control/src/db-analyzer/workflow.mjs',
 'services/bi-control/src/db-analyzer/relational-core-workflow.mjs',
 'services/bi-control/src/db-analyzer/sqlalchemy-core-worker.py',
 'tests/helpers/relational-core-native-worker-probe.py','tests/helpers/relational-core-owned-fixture.py',
 'tests/relational-core-product.test.mjs','tests/relational-core-runtime-ci-binding.test.mjs',
 'tests/canonical-test-topology.test.mjs','tests/source-map.test.mjs',
 'tests/ks255-journey-runtime-binding.test.mjs','tests/postgresql-c2-safe-aggregate.test.mjs',
 'verification/relational-core-worker-comparison-v1.json',
];
const map=JSON.parse(await readFile('SOURCE-MAP.json','utf8'));
for(const name of authored)map.files[name]=createHash('sha256').update(await readFile(name)).digest('hex');
map.files=Object.fromEntries(Object.entries(map.files).sort(([a],[b])=>a.localeCompare(b)));
const temporary=`SOURCE-MAP.json.ks288-${process.pid}.tmp`;
await writeFile(temporary,JSON.stringify(map,null,2)+'\n',{flag:'wx'});await rename(temporary,'SOURCE-MAP.json');
console.log(JSON.stringify({authoredFiles:authored.length,totalEntries:Object.keys(map.files).length,historicalEvidenceReminted:false,packageCommandModified:false}));
