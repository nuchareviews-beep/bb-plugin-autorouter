# BB Auto Router

Auto Router is a standalone bb extension that creates new threads after
choosing a concrete provider, model, and reasoning level from:

1. a model-rated 0–100 task difficulty;
2. live Codex, Claude Code, and Cursor quota remaining;
3. a bundled CursorBench 3.2 score and cost-per-task snapshot; and
4. a user-controlled `$` to `$$$` frugality preference.

No third-party benchmark API is called at runtime. Grok 4.5's published scores
are reduced by 10% as part of the local policy.

## Install

```sh
npm install
bb plugin install . --yes
```

Open **Auto Router** in bb's sidebar, compose with bb's native new-thread
composer, and submit. The extension preserves project, environment,
permission, prompt, mentions, and attachments. It classifies the task, shows
the score and selected agent, creates the real thread with an explicit
provider/model/reasoning tuple, and opens it.

Settings live under **Extensions → Plugins → Auto Router** and autosave. The
same policy is available to agents and scripts:

```sh
bb autorouter status
bb autorouter config --frugality 25
bb autorouter config --instructions "Route CSS-only work to Composer 2.5."
bb autorouter route --prompt "Fix the header spacing"
```

## Routing policy

The classifier is instructed to return only compact JSON containing a 0–100
difficulty score. `automatic` prefers a model with the lightest available
reasoning. Cursor currently advertises `none` on individual model rows while
its ACP launch contract accepts `low` as the minimum, so the extension
reconciles to `low`. If classification fails, routing uses 50/100 and records a
plugin warning.

At the frugality endpoints, the capability curves are anchored to:

| Difficulty | `$`                | `$$$`            |
| ---------: | ------------------ | ---------------- |
|          1 | GPT-5.6 Luna low   | Grok 4.5 medium  |
|         50 | GPT-5.6 Luna high  | GPT-5.6 Sol high |
|         75 | Grok 4.5 medium    | Fable 5 high     |
|        100 | GPT-5.6 Sol medium | Fable 5 max      |

Intermediate values interpolate between those anchors. Provider quota adds a
penalty that grows each time remaining quota halves. A 1/100 task cannot reach
the strongest endpoint and a 100/100 task cannot reach the weakest endpoint.

The classifier may return a model override only when the user prompt requests
that model or custom instructions explicitly route the matching task to it.
The extension independently checks that the model exists and its name is
grounded in one of those two sources before honoring the override.

## Current bb extension boundary

bb 0.39 plugins cannot intercept the native root New Thread submit or insert
synthetic thought rows into a core thread timeline. Auto Router therefore uses
its own sidebar page containing bb's native `NewThreadComposer`; routing
activity is shown on that page and in a toast. The created thread itself is a
normal bb thread owned by the selected provider.

## Development

```sh
npm test
npm run typecheck
npm run build
bb plugin dev
```
