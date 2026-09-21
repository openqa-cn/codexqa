#!/usr/bin/env python3
"""
Agent-inline LLM handoff for codexqa-defect-analyzer.

Default judgment path: the Cursor/agent model that invoked this skill reads
rendered prompts and writes findings JSON — no LLM_API_KEY required.

Detection dimensions (merged + deduped at finalize):
  1. deterministic — SAST/lint/secrets/SCA collect
  2. agent_llm     — host embedded model (Stage1 agent_detect → Stage2 verify)

Bundle layout under <output>/agent_llm/:
  MANIFEST.json
  stage1_prompt.md          (Agent LLM Detection; incremental) or shards/<id>/...
  stage1.json               (agent writes — agent_detect round)
  stage2_prompt.md          (after agent-stage2)
  llm_final.json            (agent writes — verified)
  collect.json / ctx.json / sast.json / meta.json
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: F401 — require Python 3.10+ (re-exec if needed)

def bundle_dir(output_dir):
    d = os.path.join(output_dir, 'agent_llm')
    os.makedirs(d, exist_ok=True)
    return d

def write_json(path, obj):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    json.dump(obj, open(path, 'w'), ensure_ascii=False, indent=2)

def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    return json.load(open(path))

def write_incremental_handoff(output_dir, *, collect, ctx, stage1_prompt, repo):
    """After deterministic collect+context: hand Stage1 prompt to the agent."""
    b = bundle_dir(output_dir)
    write_json(os.path.join(b, 'collect.json'), collect)
    write_json(os.path.join(b, 'ctx.json'), ctx)
    write_json(os.path.join(b, 'sast.json'), collect.get('sast_findings') or [])
    meta = dict(collect)
    meta['budget_note'] = ctx.get('budget_note', '')
    meta['context_level'] = ctx.get('level', '')
    meta['files_scanned'] = len(collect.get('changed_files', []))
    meta['target'] = '%s@%s' % (
        os.path.basename(collect.get('repo', '') or repo or ''),
        collect.get('head', 'HEAD'))
    meta['deterministic_first'] = True
    meta['sast_clear_count'] = len(collect.get('sast_clear') or [])
    meta['sast_ambiguous_count'] = len(collect.get('sast_ambiguous') or [])
    meta['scan_type'] = 'incremental'
    meta['llm_provider'] = 'agent_inline'
    meta['detection_dimensions'] = ['deterministic', 'agent_llm']
    meta['repo'] = collect.get('repo') or repo
    write_json(os.path.join(b, 'meta.json'), meta)
    open(os.path.join(b, 'stage1_prompt.md'), 'w').write(stage1_prompt)
    manifest = {
        'llm_mode': 'agent',
        'scan_type': 'incremental',
        'bundle_dir': os.path.abspath(b),
        'repo': meta['repo'],
        'primary_language': collect.get('primary_language') or 'unknown',
        'language_confidence': collect.get('language_confidence') or 'unknown',
        'detection_dimensions': ['deterministic', 'agent_llm'],
        'steps': [
            '1. Read stage1_prompt.md. YOU are the Agent LLM Detection dimension '
            '(host embedded model; no API key). One analysis round.',
            '2. Write stage1.json as {"findings":[...]} per references/output_schema.json.',
            '3. Run: python3 scripts/run_scan.py agent-stage2 --agent-dir <bundle_dir>',
            '4. Read stage2_prompt.md; write llm_final.json as {"findings":[...]} '
            '(optional dismissals:[{file,line,reason}] for ambiguous SAST FPs).',
            '5. Run: python3 scripts/run_scan.py finalize --agent-dir <bundle_dir> -o <report_dir> '
            '(merges + dedupes deterministic ∪ agent_llm).',
        ],
        'paths': {
            'stage1_prompt': 'stage1_prompt.md',
            'stage1_out': 'stage1.json',
            'stage2_prompt': 'stage2_prompt.md',
            'llm_final': 'llm_final.json',
            'sast': 'sast.json',
            'meta': 'meta.json',
        },
    }
    write_json(os.path.join(b, 'MANIFEST.json'), manifest)
    print('AGENT_LLM_HANDOFF bundle=%s' % os.path.abspath(b), file=sys.stderr)
    print(json.dumps({'agent_llm_handoff': True, 'bundle_dir': os.path.abspath(b),
                      'next': manifest['steps']}, ensure_ascii=False, indent=2))
    return b

def write_full_handoff(output_dir, *, coll, shard_jobs, repo):
    """
    shard_jobs: list of {id, stage1_prompt, ctx, deep_files, summary_prompt?}
    Full scan agent mode skips live summary LLM — deep files already chosen deterministically.
    """
    b = bundle_dir(output_dir)
    shards_dir = os.path.join(b, 'shards')
    os.makedirs(shards_dir, exist_ok=True)
    write_json(os.path.join(b, 'collection.json'), coll)
    write_json(os.path.join(b, 'sast.json'), coll.get('sast_findings') or [])
    meta = {
        'scan_type': 'full',
        'repo': coll.get('repo') or repo,
        'head': coll.get('generated_at'),
        'target': (coll.get('repo') or repo or '?') + '@full',
        'files_scanned': coll.get('file_count', 0),
        'deterministic_first': True,
        'primary_language': coll.get('primary_language') or 'unknown',
        'language_confidence': coll.get('language_confidence') or 'unknown',
        'language_source': coll.get('language_source') or 'unknown',
        'code_metrics': coll.get('code_metrics'),
        'tooling_status': coll.get('tooling_status') or {},
        'sast_clear_count': len(coll.get('sast_clear') or []),
        'sast_ambiguous_count': len(coll.get('sast_ambiguous') or []),
        'llm_provider': 'agent_inline',
        'detection_dimensions': ['deterministic', 'agent_llm'],
        'hot_files': coll.get('hot_files', [])[:50],
        'intent': coll.get('intent') or '',
        'rag_intent': coll.get('rag_intent') or '',
    }
    write_json(os.path.join(b, 'meta.json'), meta)
    write_json(os.path.join(b, 'heat_map.json'), coll.get('hot_files', [])[:50])
    shard_ids = []
    for job in shard_jobs:
        sid = job['id']
        safe = sid.replace('/', '_').replace('#', '_')
        sd = os.path.join(shards_dir, safe)
        os.makedirs(sd, exist_ok=True)
        open(os.path.join(sd, 'stage1_prompt.md'), 'w').write(job['stage1_prompt'])
        write_json(os.path.join(sd, 'ctx.json'), job.get('ctx') or {})
        write_json(os.path.join(sd, 'meta.json'), {'shard': sid, 'deep_files': job.get('deep_files')})
        shard_ids.append({'id': sid, 'dir': 'shards/%s' % safe})
    manifest = {
        'llm_mode': 'agent',
        'scan_type': 'full',
        'bundle_dir': os.path.abspath(b),
        'primary_language': coll.get('primary_language') or 'unknown',
        'language_confidence': coll.get('language_confidence') or 'unknown',
        'detection_dimensions': ['deterministic', 'agent_llm'],
        'shards': shard_ids,
        'steps': [
            '1. For each shards/<id>/stage1_prompt.md: Agent LLM Detection round — '
            'write shards/<id>/stage1.json {"findings":[...]}.',
            '2. Run: python3 scripts/run_scan.py agent-stage2 --agent-dir <bundle_dir>',
            '3. For each shards/<id>/stage2_prompt.md: write shards/<id>/stage2.json {"findings":[...]} '
            '(optional dismissals for ambiguous SAST FPs).',
            '4. Run: python3 scripts/run_scan.py finalize --agent-dir <bundle_dir> -o <report_dir> '
            '(merges + dedupes deterministic ∪ agent_llm).',
        ],
    }
    write_json(os.path.join(b, 'MANIFEST.json'), manifest)
    print('AGENT_LLM_HANDOFF bundle=%s shards=%d' % (os.path.abspath(b), len(shard_ids)),
          file=sys.stderr)
    print(json.dumps({'agent_llm_handoff': True, 'bundle_dir': os.path.abspath(b),
                      'shards': len(shard_ids), 'next': manifest['steps']},
                     ensure_ascii=False, indent=2))
    return b
