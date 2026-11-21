'use strict';

const { existsSync } = require('node:fs');
const path = require('node:path');

function cargarEntorno() {
    const explicit = process.env.VALESTRACK_SHARED_CONFIG;
    if (explicit) {
        process.loadEnvFile(explicit);
        return true;
    }

    const defaultFiles = ['.env.local', '.env'].map(name => path.join(__dirname, name));
    const selected = defaultFiles.filter(file => existsSync(file));
    for (const file of selected) process.loadEnvFile(file);
    return selected.length > 0;
}

module.exports = { cargarEntorno };
