# Local directory planning rules

Plan **local** directory ownership for this batch of test cases, so Stage 6 can write the cases as Markdown. Do not read a remote case-platform directory tree, do not assign remote `nodeId`, and do not call any `tcm_*.py` script.

---

## Directory-structure principles

The local directory uses a four-level structure, from coarse to fine:

```
Business domain
  └── Page / module
        └── Feature point
              └── Test type     ← leaf level; hang cases here
```

- Module names come from the Stage 1 function list and the Stage 4 scenario table; use business names, not requirement codes.
- Mark [New] only; this Skill does not create remote directory nodes.
- When a leaf directory has too many cases, split one more layer by feature point or test type; this only affects local grouping.

---

## Planning output

Give each case a local path (module / feature point / test type) and write it into the directory-structure section of the case list. Do not fill in remote `nodeId`, `groupId`, or case-platform links.

Subsequent local files land per end under `{run_dir}/testcase/cases/` (and `initialcase/` during generation); directory names must match the planning table.
