```json
{
  "id": "s0-environment",
  "title": "Bootstrap the environment",
  "order": 0,
  "status": "draft",
  "goal": "A fresh Claude Project installs the v2 plugin from this repo alone, and every session starts with its tools, rules and versions checked and recorded.",
  "gate": [
    {
      "id": "fresh-install",
      "check": "A new thread in the v2 project installs the plugin and writes its fingerprint and self-check rows; the fingerprint's plugin version equals the latest harness-v* release (a tag or a release/ branch) and the self-check passes",
      "how": "The two rows in the journal, read by a session other than the one that wrote them"
    },
    {
      "id": "one-sitting",
      "check": "Every allow rule and setting the thin path needs was placed in one sitting with one rebuild",
      "how": "plan/decisions/person-setup-sitting.md"
    }
  ]
}
```

The bottleneck before anything else: v1 lost hours to rules that hadn't loaded, stale installs and
threads refused for editing their own plugin. Nothing later is trustworthy until a session can say what it
is running and that its tools work.
