# Contributing

Thanks for taking the time. Issues and pull requests are welcome at
<https://github.com/devrobotlabs/visionapi-react>.

If your question is about the **API itself** — a preset, a credit cost, a limit, an error
code — <https://support.visionapi.io> reaches the team faster than an issue here does. This
repository is the React client; the service it talks to is documented at
<https://docs.visionapi.io>.

## Getting set up

```bash
git clone https://github.com/devrobotlabs/visionapi-react.git
cd visionapi-react
npm install
```

## Before you open a pull request

Run what CI runs:

```bash
npm run typecheck
npm test
```

The test suite stubs the transport, so it needs **no API key and makes no network calls**.
A test that reaches the real API will not be merged — it makes the suite slow, flaky, and
impossible to run on a fork.

This package never talks to the API directly. If a change makes it hold an API key in the browser, it is the wrong change — see the README's proxy examples for the shape that is correct.

## One contract, nine libraries

This is one of nine clients — Node, Python, Go, Ruby, PHP, Java, Swift, React and Vue — that
deliberately expose the same surface, named the way each language names things. A change to
behaviour rather than to style is usually a change all nine need, so say so in the pull
request and we will sort out the rest of the set.

Three rules the libraries exist to get right, and which any change has to preserve:

- **Every scalar is wrapped** in `{value, confidence}`, and a line-item array is a *bare*
  array whose cells are wrapped individually — not a wrapped array of plain values.
- **Absent is not missing.** A preset response contains every field of the preset, with the
  ones the document did not carry as `value: null`. Do not drop them.
- **Retries cannot double-charge.** Every billable POST carries a generated
  `Idempotency-Key`; 429 honours the server's `Retry-After`, and 402 and input errors are
  never retried because they cannot succeed.

## Style

Match the surrounding code. The linters listed above are the arbiter for everything they
cover; for everything else, the existing files are.

## Reporting a security issue

Please do not open a public issue — see [SECURITY.md](./SECURITY.md).
