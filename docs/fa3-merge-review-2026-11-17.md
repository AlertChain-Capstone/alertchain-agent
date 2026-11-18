# FA1/FA3 combined-branch review — November 17, 2026

## Starting state, comparison and backup

The checked-out branch was `feature/fa1-arch_2` at
`4f823b8e29c2d72d44862ce1c1016191c2ed57db`. There were no staged or tracked changes.
The existing untracked `docs/current-floci-bedrock-architecture.md` was copied to
an external backup and left unchanged and untracked. Its SHA-256 was verified
against the starting copy. Ignored `.env.local` was also backed up and preserved.

After fetching origin without merging:

| Reference | Commit | Comparison with starting combined branch |
| --- | --- | --- |
| `origin/main` | `7c2a43b7f680c4df406ac6e3a6b13b911f849507` | Combined branch was one commit ahead, zero behind |
| `origin/feature/fa3-arch` | `0fadb3a91ec2d1093938101e3af503aa301d809c` | One combined-only commit and three FA3-only commits |

The three incoming commits were:

- `0d1f2af` — Connect the incident dashboard and reports to stored investigations.
- `a45b174` — Cover incident navigation and cancel inactive investigation reads.
- `0fadb3a` — Answer incident questions from cited evidence.

Backup branch: `backup/fa1-arch_2-before-fa3-20261117`, pointing to the starting
`4f823b8` commit. External backup, named using UTC:
`C:\Users\makil\AppData\Local\Temp\alertchain-fa3-merge-20261118T021433Z`.
It contains a full pre-merge Git bundle, original status/refs/patches, and copies
of the untracked document and ignored configuration. Original `main`,
`feature/fa1-arch`, and `feature/aws-deployment` refs were checked and remain unchanged.

## What the merge adds

- Live incident list/dashboard and report retrieval through GET `/incidents` and
  GET `/incidents/{incidentId}`, with backend filtering, paging and stable ordering.
- Incident repository get/list operations in both DynamoDB and in-memory adapters.
  Reads join only evidence cited by the incident and belonging to its investigation;
  missing evidence is displayed explicitly. Legacy records can lack timestamps;
  newly created incidents record `created_at` without rewriting old records.
- Live report/evidence screens and alert/investigation/report navigation. FA1's
  Open incident action is now enabled when its association supplies an ID and its
  navigation callback exists. FA2 derives its incident link from create_incident
  tool output belonging to the same investigation.
- POST `/incidents/{incidentId}/questions`, backed by Bedrock and a bounded
  incident-scoped evidence context. The model selects recorded evidence fields;
  the service validates the references and reconstructs the displayed answer
  from those exact fields instead of rendering arbitrary model prose. Unsupported
  questions/invalid references produce a limitation; model/service failures stay errors.
- Shared HTTP/error handling and the reusable cancellation-aware read hook, with
  question drafts isolated by incident and late/cancelled answers rejected.
- Three additional SAM HTTP routes, without changes to the four DynamoDB table
  definitions or new Python package requirements.

## Conflict resolution and semantic review

Git reported one textual conflict, in `docs/local-setup.md`. The resolution keeps
our branch/Region/model/startup guidance and records that both investigations and
incident questions can incur real Bedrock usage. It also incorporates Mattias's
live-report workflow while clearly distinguishing source changes from the old
deployed Floci application and dated November 16 verification reports.

Automatically merged overlapping code was reviewed. The combined result retains:

- FA1 alert filtering, paging, normalized details, independent raw/association reads,
  and failure handling, alongside the new live incident handoff.
- Our common API-URL precedence and trailing-slash normalization, with the existing
  conflicting-alias regression test retained.
- Our Linux Python 3.12 vendor-path guard, so Lambda wheels do not break Windows tests.
- Our configurable Region-local model and separate real-Bedrock/local-service endpoints.
- Mattias's shared HTTP client, incident links, live reports, scoped question handling,
  and inactive-screen read behavior.

Two small integration adjustments were made: a duplicate inactive-screen early
return introduced by the automatic merge was reduced to one, and the older local
browser verifier now expects Open incident to be enabled. That verifier was not
run against the unchanged old deployment; its current expectation requires deploying
the combined source in a separate authorized task.

## Validation

| Check | Result |
| --- | --- |
| Backend: pytest `backend/tests -q -p no:cacheprovider` | **355 passed**, using the existing temporary test venv; one existing Starlette/httpx deprecation warning |
| Frontend: `npm test` | **37 passed** |
| ESLint: `npm run lint` | Passed |
| Production build: `npm run build` | Passed; 67 modules built |
| Prototype browser suite: `npm run test:e2e` | **11 passed** |
| Live FA1/FA3 contract browsers: `npm run test:fa1-live` | **21 passed**: 14 FA1 tests plus 7 FA3 tests |
| Offline SAM translation | Passed; all ten API paths present; four table definitions identical to the starting branch; regional Nova Lite parameter retained |
| Merge markers / whitespace | No unresolved conflicts or whitespace errors |
| Preservation / credential-pattern checks | Starting document and configuration unchanged; original branch refs unchanged; no credential patterns found in staged changes |

Browser checks used installed Microsoft Edge and isolated Vite test servers on 5178
and 5180. The prototype server was explicitly forced to mock mode; the live-contract
server used intercepted HTTP responses at `/__fa1_api`. Backend Bedrock dependencies
were faked by the test suite. These checks do not invoke AWS models or query/write
the running Floci database. Test servers were stopped by Playwright after completion.

All requested categories of local checks were available and ran successfully.
No application deployment, live database acceptance run, charged Bedrock question,
AWS infrastructure validation, push, or main-branch merge was performed.

## Readiness and remaining work

The combined source is ready for main-branch review based on the passing local
regression checks; there are no unresolved merge conflicts or observed test failures.
This is not a claim of deployed acceptance or production readiness.

Before treating the deployed combined application as verified, perform a separately
authorized local deployment and check an existing alert -> incident report -> cited
question through the actual API and stored data. A real question can incur Bedrock
charges and needs valid model credentials; it was deliberately not tested here.
Until then, the static Floci website/backend still represent the earlier deployment.

Known limits remain: incident portfolio reads scan the incident table, actor baselines
are empty, model credentials exported into local Lambda expire, and model quality/
semantic correctness is not established by mocked tests. Existing AWS IAM examples
and production access controls still require separate AWS-deployment review. Dated
November 16 architecture/verification documents describe historical behavior; the
user's untracked architecture document was intentionally not rewritten or committed.
