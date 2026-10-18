# Contributing

Issues and pull requests are welcome.

```sh
npm install --legacy-peer-deps
npm run typecheck
npm test
npm run build
```

- Keep the library free of runtime dependencies. It only uses `fetch` and Web Crypto so it runs everywhere.
- Types follow the field names of the [Kick API documentation](https://docs.kick.com), in snake_case.
- Add a test for every change in behaviour and a line in `CHANGELOG.md`.
