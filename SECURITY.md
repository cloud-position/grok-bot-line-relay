# Security Policy

日本語 | [English](#english)

## 脆弱性の報告

公開の Issue にはしないでください。リポジトリの **Security** タブ →「**Report a vulnerability**」から、非公開で報告してください。

見つけた内容、再現の手順、悪用されると何ができるかを書いてください。本物のトークン・合言葉・Webhook の URL は書かないでください。

## 対象のバージョン

`main` の最新のコミットだけが対象です。Deploy ボタンで作ったリポジトリはフォークではない別のリポジトリなので、修正は自動では届かず、`git pull` でも取り込めません。修正が出たら、変わったファイル（主に `src/`）を最新の `main` からあなたのリポジトリにコピーしてコミットしてください。

---

## English

### Reporting a vulnerability

Please do not open a public issue. Report it privately from the repository's **Security** tab → **Report a vulnerability**.

Include what you found, how to reproduce it, and what an attacker could do with it. Never include real tokens, passphrases or webhook URLs.

### Supported versions

Only the latest commit on `main` is supported. The Deploy button creates a separate repository, not a fork, so fixes do not reach it automatically and cannot be pulled with `git pull`. When a fix is released, copy the changed files (mostly under `src/`) from the latest `main` into your repository and commit them.
