# Security policy

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues, pull requests, or
discussions.** A public report is a disclosure, and it puts every user of this library at
risk before there is a fix to move to.

Report privately through either:

- **GitHub** — the *Report a vulnerability* button under this repository's **Security** tab,
  which opens a private advisory only the maintainers can see; or
- **<https://support.visionapi.io>**, or <https://visionapi.io/contact-us> if you do not have
  an account.

Please include what you need to make the problem reproducible: the version, the platform, and
the smallest example that shows it. If you have a suggested fix, all the better — but a clear
report on its own is worth more than a vague one with a patch.

We will acknowledge your report, keep you updated as we work on it, and credit you in the
advisory unless you would rather we did not.

## Supported versions

Fixes land on the latest released version. There are no long-term support branches; if you
are behind, the upgrade path is forward.

## Scope

In scope: anything in this repository that lets an attacker read or alter data they should
not, forge a webhook signature, leak an API key, or execute code through untrusted input.

Out of scope here, but still worth telling us about at <https://support.visionapi.io>:
problems in the Vision API service rather than this client, and anything about an account,
billing, or the website.

## A note on API keys

A Vision API key is a spending credential. There is no publishable key and no test mode, so a
key that reaches a browser bundle is readable by anyone who loads the page. The React and Vue
packages exist precisely so a frontend never has to hold one: they call *your* endpoint, which
holds the key server-side. If you find a code path in any of these libraries that could put a
key in front of an end user, that is a vulnerability and we want to hear about it.
