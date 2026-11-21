'use strict';

const { readdirSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

let scripts = 0;
let datasets = 0;
for (const directory of [__dirname, path.join(__dirname, 'public')]) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const file = path.join(directory, entry.name);
        if (file.endsWith('.js') || file.endsWith('.ts')) {
            const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
            if (result.error) throw result.error;
            if (result.status !== 0) process.exit(result.status ?? 1);
            scripts++;
        } else if (file.endsWith('.json')) {
            JSON.parse(readFileSync(file, 'utf8'));
            datasets++;
        }
    }
}
console.log(`Build correcto: ${scripts} scripts y ${datasets} archivos JSON validados.`);
