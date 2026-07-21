# .starter-kit/

Meta-documentation for maintaining the starter kit itself.

**If you copied this kit to build your own app, you can delete this directory.** Note that the root `README.md` references images under `docs/imgs/` — you will rewrite that README for your own app anyway.

## Contents

| Path                                             | Audience                  | Content                                                                                                                    |
| ------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [`DESIGN_PRINCIPLES.md`](./DESIGN_PRINCIPLES.md) | Contributors, maintainers | Design decisions, quality standards, review checks, and the major version process. Required reading before making changes. |
| `docs/<version>/`                                | Maintainers, upgraders    | ADRs, design docs, and AI migration prompts for each major version.                                                        |
| `docs/imgs/`                                     | Root README               | Architecture diagram (drawio + png) and screenshots.                                                                       |

## Entry points by role

- **Using the kit** → root [`README.md`](../README.md), then [`AGENTS.md`](../AGENTS.md) for the development guide.
- **Contributing a fix or feature** → [`CONTRIBUTING.md`](../CONTRIBUTING.md), then [`DESIGN_PRINCIPLES.md`](./DESIGN_PRINCIPLES.md).
- **Upgrading your copy across major versions** → `docs/<version>/migration-prompt*.md` (an AI agent meta-prompt; point your coding agent at it).
