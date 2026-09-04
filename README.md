# transcriptasm

Offline speech-to-text in the browser via Whisper WASM.

**Live:** [https://transcriptasm.quad4.io](https://transcriptasm.quad4.io)

## Install (Docker)

```bash
git clone git@github.com:Quad4-Software/transcriptasm.git
cd transcriptasm
docker compose up --build
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

Coolify: use `docker-compose.coolify.yml` and set the domain to container port `8080`.

## Build from source

Needs Go 1.26+, Node (for tests), and the vendored `web/` assets (models + WASM).

```bash
git clone git@github.com:Quad4-Software/transcriptasm.git
cd transcriptasm
make assets   # if models or fonts are missing
make build
make run
```

```bash
make test
make check
```

Binary: `bin/transcriptasm` (default listen `:8080`, web root `web`).

## License

MIT
