# monerochan-wallet

To install dependencies:

```bash
bun install
```

To build:

```bash
bun run build
```

### local build (no npm reliance) 

self build without reliance on npm:


checkout https://github.com/monerochan-ecosystem/monero-wallet-api
in a sibling folder,
follow the build instructions: https://github.com/monerochan-ecosystem/monero-wallet-api/blob/master/typescript/README.md
replace devDependencies in package.json:

``` json
 "devDependencies": {
    "@spirobel/monero-wallet-api": "../monero-wallet-api/typescript/",
    "@spirobel/seedphrase": "../monero-wallet-api/seedphrase/",
```

then:
```bash
bun run build
```

