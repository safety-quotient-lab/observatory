#!/usr/bin/env python3
"""Generate SQL statements from an HRCB eval JSON file.

Usage:
  python3 eval-to-sql.py <eval.json> <hn_id> <eval_model> scores    > scores.sql
  python3 eval-to-sql.py <eval.json> <hn_id> <eval_model> witness   > witness.sql
  python3 eval-to-sql.py <eval.json> <hn_id> <eval_model> signals   > signals.sql
"""
import json, sys

ALL_SECTIONS = ["Preamble"] + [f"Article {i}" for i in range(1, 31)]

def sql_esc(v):
    """Escape a value for SQL single-quoted string."""
    if v is None:
        return "NULL"
    s = str(v).replace("'", "''")
    return f"'{s}'"

def sql_num(v):
    if v is None:
        return "NULL"
    return str(v)

def sql_bool(v):
    if v is True:
        return "1"
    if v is False:
        return "0"
    return "NULL"

def gen_scores(data, hn_id, eval_model):
    print(f"DELETE FROM rater_scores WHERE hn_id = {hn_id} AND eval_model = {sql_esc(eval_model)};")
    for s in data.get("scores", []):
        sec = s.get("section", "")
        so = ALL_SECTIONS.index(sec) if sec in ALL_SECTIONS else 0
        ed = sql_num(s.get("editorial"))
        st = sql_num(s.get("structural"))
        ev = sql_esc(s.get("evidence"))
        dr = sql_esc(json.dumps(s.get("directionality", [])))
        en = s.get("editorial_note", "") or ""
        sn = s.get("structural_note", "") or ""
        note = en or sn
        print(
            f"INSERT INTO rater_scores "
            f"(hn_id, section, eval_model, sort_order, final, editorial, structural, evidence, directionality, note, editorial_note, structural_note) "
            f"VALUES ({hn_id}, {sql_esc(sec)}, {sql_esc(eval_model)}, {so}, {sql_num(s.get('final'))}, {ed}, {st}, {ev}, {dr}, {sql_esc(note)}, {sql_esc(en)}, {sql_esc(sn)});"
        )

def gen_witness(data, hn_id, eval_model):
    print(f"DELETE FROM rater_witness WHERE hn_id = {hn_id} AND eval_model = {sql_esc(eval_model)};")
    for s in data.get("scores", []):
        sec = s.get("section", "")
        for fact in s.get("witness_facts", []):
            print(
                f"INSERT INTO rater_witness (hn_id, eval_model, section, fact_type, fact_text) "
                f"VALUES ({hn_id}, {sql_esc(eval_model)}, {sql_esc(sec)}, 'observable', {sql_esc(fact)});"
            )
        for inf in s.get("witness_inferences", []):
            print(
                f"INSERT INTO rater_witness (hn_id, eval_model, section, fact_type, fact_text) "
                f"VALUES ({hn_id}, {sql_esc(eval_model)}, {sql_esc(sec)}, 'inference', {sql_esc(inf)});"
            )

def gen_signals(data, hn_id, eval_model):
    ct = (data.get("evaluation", {}).get("content_type", {}).get("primary") or "MX")
    sv = data.get("schema_version")
    tt = data.get("theme_tag")
    st = data.get("sentiment_tag")
    es = data.get("executive_summary")

    cols = [
        f"content_type = {sql_esc(ct)}",
        f"schema_version = {sql_esc(sv)}",
        f"hcb_theme_tag = {sql_esc(tt)}",
        f"hcb_sentiment_tag = {sql_esc(st)}",
        f"hcb_executive_summary = {sql_esc(es)}",
    ]

    # Epistemic Quality
    eq = data.get("epistemic_quality")
    if eq:
        cols.append(f"eq_score = {sql_num(eq.get('eq_score'))}")
        cols.append(f"eq_source_quality = {sql_num(eq.get('source_quality'))}")
        cols.append(f"eq_evidence_reasoning = {sql_num(eq.get('evidence_reasoning'))}")
        cols.append(f"eq_uncertainty_handling = {sql_num(eq.get('uncertainty_handling'))}")
        cols.append(f"eq_purpose_transparency = {sql_num(eq.get('purpose_transparency'))}")
        cols.append(f"eq_claim_density = {sql_esc(eq.get('claim_density'))}")

    # Propaganda Flags
    pf = data.get("propaganda_flags", [])
    cols.append(f"pt_flag_count = {len(pf)}")
    if pf:
        cols.append(f"pt_flags_json = {sql_esc(json.dumps(pf))}")

    # Solution Orientation
    so = data.get("solution_orientation")
    if so:
        cols.append(f"so_score = {sql_num(so.get('so_score'))}")
        cols.append(f"so_framing = {sql_esc(so.get('framing'))}")
        cols.append(f"so_reader_agency = {sql_num(so.get('reader_agency'))}")

    # Emotional Tone
    et = data.get("emotional_tone")
    if et:
        cols.append(f"et_primary_tone = {sql_esc(et.get('primary_tone'))}")
        cols.append(f"et_valence = {sql_num(et.get('valence'))}")
        cols.append(f"et_arousal = {sql_num(et.get('arousal'))}")
        cols.append(f"et_dominance = {sql_num(et.get('dominance'))}")

    # Stakeholder Representation
    sr = data.get("stakeholder_representation")
    if sr:
        cols.append(f"sr_score = {sql_num(sr.get('sr_score'))}")
        cols.append(f"sr_perspective_count = {sql_num(sr.get('perspective_count'))}")
        cols.append(f"sr_voice_balance = {sql_num(sr.get('voice_balance'))}")
        cols.append(f"sr_who_speaks = {sql_esc(json.dumps(sr.get('who_speaks', [])))}")
        cols.append(f"sr_who_spoken_about = {sql_esc(json.dumps(sr.get('who_is_spoken_about', [])))}")

    # Temporal Framing
    tf = data.get("temporal_framing")
    if tf:
        cols.append(f"tf_primary_focus = {sql_esc(tf.get('primary_focus'))}")
        cols.append(f"tf_time_horizon = {sql_esc(tf.get('time_horizon'))}")

    # Geographic Scope
    gs = data.get("geographic_scope")
    if gs:
        cols.append(f"gs_scope = {sql_esc(gs.get('scope'))}")
        cols.append(f"gs_regions_json = {sql_esc(json.dumps(gs.get('regions_mentioned', [])))}")

    # Complexity Level
    cl = data.get("complexity_level")
    if cl:
        cols.append(f"cl_reading_level = {sql_esc(cl.get('reading_level'))}")
        cols.append(f"cl_jargon_density = {sql_esc(cl.get('jargon_density'))}")
        cols.append(f"cl_assumed_knowledge = {sql_esc(cl.get('assumed_knowledge'))}")

    # Transparency & Disclosure
    td = data.get("transparency_disclosure")
    if td:
        cols.append(f"td_score = {sql_num(td.get('td_score'))}")
        cols.append(f"td_author_identified = {sql_bool(td.get('author_identified'))}")
        cols.append(f"td_conflicts_disclosed = {sql_bool(td.get('conflicts_disclosed'))}")
        cols.append(f"td_funding_disclosed = {sql_bool(td.get('funding_disclosed'))}")

    cols.extend([
        "eval_status = 'rescoring'",
        "eval_error = NULL",
        "evaluated_at = datetime('now')",
    ])

    print(f"UPDATE stories SET {', '.join(cols)} WHERE hn_id = {hn_id};")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    eval_file, hn_id, eval_model, mode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    with open(eval_file) as f:
        data = json.load(f)

    if mode == "scores":
        gen_scores(data, hn_id, eval_model)
    elif mode == "witness":
        gen_witness(data, hn_id, eval_model)
    elif mode == "signals":
        gen_signals(data, hn_id, eval_model)
    else:
        print(f"Unknown mode: {mode}", file=sys.stderr)
        sys.exit(1)
