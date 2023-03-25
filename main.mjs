#!/usr/bin/env node

import { callosum, encryption, manifest, storage, utilitas } from 'utilitas';
import { consts, Socratex, ssl, web } from './index.mjs';
import { parseArgs } from 'node:util'; // https://kgrz.io/node-has-native-arg-parsing.html
import http from 'http';

const argsOptions = {
    address: { type: 'string', short: 'a', default: '' },
    bypass: { type: 'string', short: 'b', default: '' },
    debug: { type: 'boolean', short: 'd', default: false },
    domain: { type: 'string', short: 'o', default: '' },
    help: { type: 'boolean', short: 'h', default: false },
    http: { type: 'boolean', short: 't', default: false },
    password: { type: 'string', short: 'p', default: '' },
    port: { type: 'string', short: 'o', default: '0' },
    repl: { type: 'boolean', short: 'r', default: false },
    user: { type: 'string', short: 'u', default: '' },
    version: { type: 'boolean', short: 'v', default: false },
};

const [logWithTime, acmeChallenge] = [{ time: true }, { url: null, key: null }];
const warning = message => utilitas.log(message, 'WARNING');
const cleanTitle = str => str.replace('-x', '');
const { values } = parseArgs({ options: argsOptions });

const argv = {
    ...values, port: ~~values.port,
    getStatus: storage.getConfig,
    setStatus: storage.setConfig,
};

const getAddress = (ptcl, server) => {
    const { address, family, port } = server.address();
    const add = `${ptcl}://${_socratex.domain}:${port} (${family} ${address})`;
    return { address, family, port, add };
};

const setConfig = async (config) =>
    callosum.isPrimary ? await storage.setConfig(config) : null;

const ensureDomain = async () => {
    if (argv.domain) {
        await setConfig({ domain: argv.domain });
        return argv.domain;
    }
    return (await storage.getConfig())?.config?.domain || '127.0.0.1';
};

const ensureToken = async () => {
    let token = (await storage.getConfig())?.config?.token;
    if (!token) {
        token = encryption.fakeUuid();
        await setConfig({ token });
    }
    return token;
};

const ensureBasicAuth = async () => {
    const optsTrim = { trim: true };
    argv.user = utilitas.ensureString(argv.user, optsTrim);
    argv.password = utilitas.ensureString(argv.password, optsTrim);
    if (argv.user && argv.password) {
        const basicAuth = { user: argv.user, password: argv.password };
        await setConfig(basicAuth);
        return basicAuth;
    }
    const { user, password } = (await storage.getConfig())?.config || {};
    return { user, password };
};

const request = async (req, res) => {
    if (req.method === consts.HTTP_METHODS.GET && acmeChallenge.key
        && acmeChallenge.url && acmeChallenge.url === req.url) {
        return res.end(acmeChallenge.key);
    }
    res.writeHead(301, {
        Location: `${consts.HTTPS}://${_socratex.domain}${req.url}`
    }).end();
};

await utilitas.locate(utilitas.__(import.meta.url, 'package.json'));
globalThis._socratex = { https: argv.https = !argv.http };
const meta = await utilitas.which();
meta.name = cleanTitle(meta.name);
meta.title = cleanTitle(meta.title);

if (argv.help) {
    [meta.title, '', `Usage: ${meta.name} [options]`, ''].map(x => console.log(x));
    console.table(argsOptions);
    process.exit();
} else if (argv.version) {
    [meta.title, `${manifest.name} v${manifest.version}`].map(x => console.log(x));
    process.exit();
}

const port = argv.port
    || (_socratex.https ? consts.HTTPS_PORT : consts.HTTP_PORT);

const { user, password } = await ensureBasicAuth();
Object.assign(_socratex, {
    domain: await ensureDomain(), token: await ensureToken(), user, password,
});

_socratex.address = (
    _socratex.https ? consts.HTTPS.toUpperCase() : consts.PROXY
) + ` ${_socratex.domain}:${port}`;

argv.bypass = argv.bypass ? new Set(
    utilitas.ensureArray(argv.bypass).map(item => item.toUpperCase())
) : null;

if (_socratex.user && _socratex.password) {
    argv.basicAuth = async (username, password) => {
        const result = utilitas.insensitiveCompare(username, _socratex.user)
            && password === _socratex.password;
        utilitas.log(
            `Authenticate ${result ? 'SUCCESS' : 'FAILED'} => `
            + `${username}:${utilitas.mask(password)}.`,
            meta?.name, logWithTime
        );
        return result;
    };
}

if (_socratex.token) {
    argv.tokenAuth = async (token) => {
        const result = token === _socratex.token;
        utilitas.log(
            `Authenticate ${result ? 'SUCCESS' : 'FAILED'} => `
            + `TOKEN:${utilitas.mask(token)}.`,
            meta?.name, logWithTime
        );
        return result;
    };
}

await callosum.init({
    initPrimary: async () => {
        utilitas.log(`${meta.homepage}`, `${meta?.title}.*`);
        if (_socratex.https) {
            globalThis.httpd = http.createServer(request);
            httpd.listen(consts.HTTP_PORT, argv.address, async () => {
                const { add } = getAddress(consts.HTTP, httpd);
                utilitas.log(`HTTP Server started at ${add}.`, meta?.name);
            });
            if (web.isLocalhost(_socratex.domain)) {
                warning('A public domain is required to get an ACME certs.');
            } else {
                await ssl.init(_socratex.domain,
                    async (url, key) => Object.assign(acmeChallenge, { url, key }),
                    async (url) => Object.assign(acmeChallenge, { url: '', key: '' }),
                    { debug: argv.debug }
                );
            }
        } else { warning('HTTP-only mode is not recommended.'); }
        const subAdd = `${_socratex.https ? consts.HTTPS : consts.HTTP}://`;
        let webAdd = `${subAdd}${_socratex.domain}`;
        let bscAdd = `${subAdd}${_socratex.user}:${_socratex.password}@${_socratex.domain}`;
        if (_socratex.https && port === consts.HTTPS_PORT) { }
        else if (!_socratex.https && port === consts.HTTP_PORT) { }
        else {
            const tailPort = `:${port}`;
            webAdd += tailPort;
            bscAdd += tailPort;
        }
        utilitas.log('* Token authentication:', meta?.name);
        utilitas.log(`  - PAC:   ${webAdd}/proxy.pac?token=${_socratex.token}`, meta?.name);
        utilitas.log(`  - WPAD:  ${webAdd}/wpad.dat?token=${_socratex.token}`, meta?.name);
        utilitas.log(`  - Log:   ${webAdd}/console?token=${_socratex.token}`, meta?.name);
        if (!_socratex.user || !_socratex.password) { return }
        utilitas.log('* Basic authentication:', meta?.name);
        utilitas.log(`  - PAC:   ${bscAdd}/proxy.pac`, meta?.name);
        utilitas.log(`  - WPAD:  ${bscAdd}/wpad.dat`, meta?.name);
        utilitas.log(`  - Log:   ${bscAdd}/console`, meta?.name);
        utilitas.log(`  - Proxy: ${bscAdd}`, meta?.name);
    },
    initWorker: async () => {
        globalThis.socratex = new Socratex(argv);
        return await new Promise((resolve, _) => {
            socratex.listen(port, argv.address, () => {
                const { add } = getAddress(
                    _socratex.https ? consts.HTTPS : consts.HTTP, socratex
                );
                return resolve({
                    message: `${_socratex.https
                        ? 'Secure ' : ''}Web Proxy started at ${add}.`
                });
            });
        });
    },
    onReady: async () => {
        web.init(argv);
        argv.repl && (await import('repl')).start('> ');
    },
});
