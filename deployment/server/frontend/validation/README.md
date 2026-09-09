# Fixed-upstream source contract validation

This fixture runs against the pinned DocsGPT frontend after
`patch_abstain_sources.mjs` has modified the upstream source tree. It verifies
real Redux reducers, persisted-history mapping, rejected-stream cleanup, and
clean EOF without a terminal `end` event.

The fixture must appear at this path inside the upstream source tree so its
relative imports resolve:

`/app/src/conversation/sourceContract.upstream.test.ts`

From the repository root on Windows PowerShell, run:

```powershell
$repoPath = (Get-Location).Path
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' run --rm --network none `
  --mount "type=bind,source=$repoPath\deployment\server\frontend\patch_abstain_sources.mjs,target=/tmp/patch.mjs,readonly" `
  --mount "type=bind,source=$repoPath\deployment\server\frontend\validation\sourceContract.upstream.test.ts,target=/app/src/conversation/sourceContract.upstream.test.ts,readonly" `
  --entrypoint sh `
  arc53/docsgpt-fe@sha256:ede521bce6d7cfaddd3d3e2245aaad1acf3ae116bb94483832bd793be0789d01 `
  -c 'node /tmp/patch.mjs /app/src && npx vitest run src/conversation/sourceContract.upstream.test.ts'
```

The command disables networking and uses no credentials. Expected result:
one test file and four tests pass. This is a targeted source-contract check;
it is not a replacement for the upstream TypeScript/Vite build or the local
project test suites.
