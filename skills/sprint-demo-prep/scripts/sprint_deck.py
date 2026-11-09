#!/usr/bin/env python3
"""Rebuild the Demonstration section of a INTERNAL Sprint Review deck.

The deck follows a fixed pattern (see SKILL.md): an "at a glance" card slide,
then two slides per story — a Purpose slide and a "WHAT WE'LL DEMO" slide.
This script clones the existing slides as templates so the deck's styling is
kept exactly, instead of drawing shapes from scratch.

Usage:
    sprint_deck.py inspect <deck.pptx>
    sprint_deck.py build   <deck.pptx> <content.json> <out.pptx>
    sprint_deck.py strip   <deck.pptx> <out.pptx>      # only remove screenshots
    sprint_deck.py intro   <deck.pptx> <preview-dir>   # JSON: editable text + screenshot slots of the opening slides

Requires python-pptx (pip install python-pptx).
"""
import copy
import json
import os
import re
import sys

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn
from pptx.dml.color import RGBColor
from pptx.util import Pt

STORY_TITLE_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\s*·")
KEY_START_RE = re.compile(r"[A-Z][A-Z0-9]+-\d+")
EMU_INCH = 914400
HEADER_BOTTOM = 900000      # pictures above this line are the logo, not screenshots
FOOTER_TOP = 6400000        # demo items must end above the footer rule


def is_tab_label(text):
    """Small tab captions on the purpose slide: "Purpose" and "<product>: How it works"."""
    return text == "Purpose" or text.endswith(": How it works")


# ---------------------------------------------------------------- helpers

def text_of(shape):
    return shape.text_frame.text if shape.has_text_frame else ""


def title_text(slide):
    for sh in slide.shapes:
        if sh.is_placeholder and sh.has_text_frame and sh.text_frame.text.strip():
            return sh.text_frame.text
    return ""


def title_shape(slide):
    for sh in slide.shapes:
        if sh.is_placeholder and sh.has_text_frame and sh.text_frame.text.strip():
            return sh
    return None


def is_screenshot(shape):
    if shape.shape_type != MSO_SHAPE_TYPE.PICTURE:
        return False
    return shape.top > HEADER_BOTTOM and max(shape.width, shape.height) > EMU_INCH // 2


def set_runs(paragraph, values):
    """Write values into the paragraph's first runs, keeping their formatting; blank the rest."""
    runs = paragraph.runs
    for i, run in enumerate(runs):
        run.text = values[i] if i < len(values) else ""
    if len(values) > len(runs) and runs:
        runs[-1].text = runs[-1].text + "".join(values[len(runs):])


def set_after_label(shape, label, value):
    """For 'Label: value' paragraphs: keep the label runs, put value in the first run after them."""
    tf = shape.text_frame
    runs = tf.paragraphs[0].runs
    seen, idx = "", 0
    while idx < len(runs) and label not in seen:
        seen += runs[idx].text
        idx += 1
    while idx < len(runs) and not runs[idx].text.strip():
        idx += 1
    if idx >= len(runs):
        runs[-1].text = runs[-1].text.rstrip() + " " + value
    else:
        runs[idx].text = value
        for r in runs[idx + 1:]:
            r.text = ""
    for extra in tf.paragraphs[1:]:
        extra._p.getparent().remove(extra._p)


def set_single(shape, value):
    tf = shape.text_frame
    set_runs(tf.paragraphs[0], [value])
    for extra in tf.paragraphs[1:]:
        extra._p.getparent().remove(extra._p)


def set_story_title(slide, key, title):
    sh = title_shape(slide)
    runs = sh.text_frame.paragraphs[0].runs
    split = next(i for i, r in enumerate(runs) if "·" in r.text)
    for i, r in enumerate(runs):
        if i == 0:
            r.text = f"{key} · "
        elif i == split + 1:
            r.text = title
        else:
            r.text = ""
    if split + 1 >= len(runs):
        runs[0].text = f"{key} · {title}"


def remove_shape(shape):
    el = shape._element
    el.getparent().remove(el)


def next_shape_id(slide):
    ids = [int(e.get("id")) for e in slide._element.iter() if e.tag == qn("p:cNvPr") and e.get("id", "").isdigit()]
    return max(ids, default=1) + 1


def renumber_ids(element, slide):
    nid = next_shape_id(slide)
    for e in element.iter(qn("p:cNvPr")):
        e.set("id", str(nid))
        nid += 1


def shift(element, dy):
    # the first a:off is the shape's own offset; group children use child coordinates
    off = next(element.iter(qn("a:off")))
    off.set("y", str(int(off.get("y")) + dy))


# ---------------------------------------------------------------- slide ops

def clone_slide(prs, src):
    new = prs.slides.add_slide(src.slide_layout)
    for sh in list(new.shapes):
        remove_shape(sh)
    rid_map = {}
    for rid, rel in src.part.rels.items():
        if rel.reltype.endswith(("/notesSlide", "/slideLayout")):
            continue
        if rel.is_external:
            rid_map[rid] = new.part.relate_to(rel.target_ref, rel.reltype, is_external=True)
        else:
            rid_map[rid] = new.part.relate_to(rel.target_part, rel.reltype)
    src_csld = src._element.find(qn("p:cSld"))
    new_csld = new._element.find(qn("p:cSld"))
    bg = src_csld.find(qn("p:bg"))
    if bg is not None:
        new_csld.insert(0, copy.deepcopy(bg))
    sp_tree = new.shapes._spTree
    for child in src.shapes._spTree.iterchildren():
        if child.tag in (qn("p:nvGrpSpPr"), qn("p:grpSpPr")):
            continue
        sp_tree.append(copy.deepcopy(child))
    rel_attrs = (qn("r:embed"), qn("r:link"), qn("r:id"))
    for e in sp_tree.iter():
        for a in rel_attrs:
            if e.get(a) in rid_map:
                e.set(a, rid_map[e.get(a)])
    return new


def slide_ids(prs):
    return list(prs.slides._sldIdLst)


def move_slide(prs, slide, index):
    lst = prs.slides._sldIdLst
    el = next(s for s in lst if prs.part.related_part(s.get(qn("r:id"))) is slide.part)
    lst.remove(el)
    lst.insert(index, el)


def delete_slide(prs, slide):
    lst = prs.slides._sldIdLst
    el = next(s for s in lst if prs.part.related_part(s.get(qn("r:id"))) is slide.part)
    prs.part.drop_rel(el.get(qn("r:id")))
    lst.remove(el)


def set_notes(slide, text):
    if text:
        slide.notes_slide.notes_text_frame.text = text


# ---------------------------------------------------------------- deck analysis

def classify(slide):
    title = title_text(slide)
    texts = [text_of(s) for s in slide.shapes]
    if "at a glance" in title.lower():
        return "glance"
    if STORY_TITLE_RE.search(title):
        if any("WHAT WE'LL DEMO" in t or "WHAT WE’LL DEMO" in t for t in texts):
            return "demo"
        if any(t.startswith("Purpose:") for t in texts):
            return "purpose"
        return "story-other"
    return "other"


def demo_items(slide):
    """Return [(badge_group, text_box)] pairs for numbered demo items, top to bottom."""
    groups = []
    for sh in slide.shapes:
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            digits = [s for s in sh.shapes if s.has_text_frame and s.text_frame.text.strip().isdigit()]
            if digits and sh.width < EMU_INCH // 2:
                groups.append(sh)
    pairs = []
    for g in sorted(groups, key=lambda s: s.top):
        candidates = [s for s in slide.shapes
                      if s.shape_type == MSO_SHAPE_TYPE.TEXT_BOX and s.left > g.left
                      and abs(s.top - g.top) < g.height and s.text_frame.text.strip()]
        if candidates:
            pairs.append((g, min(candidates, key=lambda s: s.left)))
    return pairs


def purpose_parts(slide):
    parts = {}
    panel_left = None
    for sh in slide.shapes:
        t = text_of(sh).strip()
        if "WHAT WE" in t and "IMPROVING" in t:
            panel_left = sh.left - EMU_INCH // 2
            parts["improving_heading"] = sh
    for sh in slide.shapes:
        if not sh.has_text_frame:
            continue
        t = sh.text_frame.text.strip()
        if not t:
            continue
        if t.startswith("Purpose:"):
            parts["purpose"] = sh
        elif t.startswith("Why it matters"):
            parts["why"] = sh
        elif sh.is_placeholder:
            parts["title"] = sh
        elif is_tab_label(t) or sh is parts.get("improving_heading"):
            continue
        elif sh.top < parts.get("purpose", sh).top and sh.width < 2 * EMU_INCH + 200000 and t.isupper():
            parts["tag"] = sh
        elif panel_left is not None and sh.left >= panel_left:
            parts["improving"] = sh
        elif sh.top > 1900000:
            parts.setdefault("headline", sh)
    return parts


def demo_tag(slide):
    for sh in slide.shapes:
        t = text_of(sh).strip()
        if sh.has_text_frame and t.isupper() and t not in ("WHAT WE'LL DEMO", "WHAT WE’LL DEMO") \
                and not sh.is_placeholder and sh.top < 1500000 and not is_tab_label(t):
            return sh
    return None


def glance_cards(slide):
    """Return [(card, bar, badge)] in reading order (row, then column)."""
    cards = [s for s in slide.shapes if s.has_text_frame and KEY_START_RE.match(s.text_frame.text)]
    rest = [s for s in slide.shapes if s not in cards and s.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE]
    out = []
    for c in cards:
        # bars and badges can sit slightly outside their card's edge
        pad = EMU_INCH // 8
        inside = [s for s in rest if c.left - pad <= s.left <= c.left + c.width
                  and c.top - pad <= s.top <= c.top + c.height]
        bar = next((s for s in inside if s.width < EMU_INCH // 4), None)
        badge = next((s for s in inside if s.has_text_frame and s.text_frame.text.strip() and s is not bar), None)
        out.append((c, bar, badge))
    rows = sorted(out, key=lambda t: t[0].top)
    # cards on the same row may differ by a few EMU in top; group by ~half a card height
    ordered, row = [], []
    for t in rows:
        if row and abs(t[0].top - row[0][0].top) > t[0].height // 2:
            ordered += sorted(row, key=lambda x: x[0].left)
            row = []
        row.append(t)
    ordered += sorted(row, key=lambda x: x[0].left)
    return ordered


def analyse(prs):
    slides = list(prs.slides)
    kinds = [classify(s) for s in slides]
    return slides, kinds


def pick_templates(slides, kinds):
    demos = [s for s, k in zip(slides, kinds) if k == "demo" and demo_items(s)]
    demo = max(demos, key=lambda s: len(demo_items(s)), default=None)
    purposes = [s for s, k in zip(slides, kinds) if k == "purpose" and
                {"purpose", "why", "improving", "headline"} <= purpose_parts(s).keys()]
    # the demo template's own Purpose slide keeps the split-colour title/headline runs
    demo_key = demo is not None and title_text(demo).split("·")[0].strip()
    purpose = next((s for s in purposes if title_text(s).split("·")[0].strip() == demo_key),
                   purposes[0] if purposes else None)
    return purpose, demo


# ---------------------------------------------------------------- opening slides (cover, agenda, sprint data, goal …)

STORY_KINDS = ("glance", "purpose", "demo", "story-other")


def iter_shapes(shapes):
    for sh in shapes:
        yield sh
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from iter_shapes(sh.shapes)


def intro_slides(slides, kinds):
    """The slides before the Demonstration section's first glance/story slide."""
    end = next((i for i, k in enumerate(kinds) if k in STORY_KINDS), len(slides))
    return slides[:end]


def editable_texts(slide):
    """Text shapes a presenter would update each sprint; skips footers, page numbers and empty placeholders."""
    out = []
    for sh in iter_shapes(slide.shapes):
        if not sh.has_text_frame:
            continue
        t = sh.text_frame.text.strip()
        if not t or t.isdigit() or "Copyright" in t:
            continue
        out.append(sh)
    return sorted(out, key=lambda s: (s.top, s.left))


def screenshot_slots(slide):
    return sorted((sh for sh in slide.shapes if is_screenshot(sh)), key=lambda s: (s.top, s.left))


def cmd_intro(path, outdir):
    prs = Presentation(path)
    slides, kinds = analyse(prs)
    os.makedirs(outdir, exist_ok=True)
    result = []
    for n, slide in enumerate(intro_slides(slides, kinds), 1):
        texts = [{"id": sh.shape_id, "text": sh.text_frame.text} for sh in editable_texts(slide)]
        images = []
        for sh in screenshot_slots(slide):
            name = f"s{n}-{sh.shape_id}.{sh.image.ext}"
            with open(os.path.join(outdir, name), "wb") as f:
                f.write(sh.image.blob)
            images.append({"id": sh.shape_id, "width": sh.width, "height": sh.height, "preview": name})
        label = title_text(slide) or (texts[0]["text"].split("\n")[0] if texts else "")
        result.append({"n": n, "title": label.strip()[:90], "texts": texts, "images": images})
    print(json.dumps({"slides": result}, ensure_ascii=False))


def set_text(shape, text):
    """Replace a text frame line by line, one line per paragraph, keeping each paragraph's first-run formatting."""
    tf = shape.text_frame
    lines = text.split("\n")
    paras = list(tf.paragraphs)
    for i, line in enumerate(lines):
        if i < len(paras):
            p = paras[i]
        else:
            el = copy.deepcopy(paras[-1]._p)
            paras[-1]._p.addnext(el)
            p = tf.paragraphs[i]
            paras = list(tf.paragraphs)
        if p.runs:
            set_runs(p, [line])
        elif line:
            run = p.add_run()
            end = p._p.find(qn("a:endParaRPr"))
            if end is not None:
                rpr = copy.deepcopy(end)
                rpr.tag = qn("a:rPr")
                run._r.insert(0, rpr)
            run.text = line
    for extra in list(tf.paragraphs)[len(lines):]:
        extra._p.getparent().remove(extra._p)


def replace_picture(slide, old, file):
    """Put `file` where `old` was: scaled to fit (contain) and centred in the old frame, same z-order."""
    left, top, width, height = old.left, old.top, old.width, old.height
    pic = slide.shapes.add_picture(file, left, top)
    ratio = pic.width / pic.height
    w, h = width, int(width / ratio)
    if h > height:
        h, w = height, int(height * ratio)
    pic.width, pic.height = w, h
    pic.left, pic.top = left + (width - w) // 2, top + (height - h) // 2
    old._element.addprevious(pic._element)
    remove_shape(old)


def apply_intro(slides, kinds, intro):
    """intro: [{"slide": n, "texts": {shape_id: text}, "images": {shape_id: path}}] — n counts the opening slides from 1."""
    opening = intro_slides(slides, kinds)
    changed = 0
    for edit in intro or []:
        n = int(edit.get("slide", 0))
        if not 1 <= n <= len(opening):
            sys.exit(f"error: intro slide {n} is not one of the {len(opening)} opening slides")
        slide = opening[n - 1]
        by_id = {sh.shape_id: sh for sh in iter_shapes(slide.shapes)}
        for sid, text in (edit.get("texts") or {}).items():
            sh = by_id.get(int(sid))
            if sh is not None and sh.has_text_frame:
                set_text(sh, text)
                changed += 1
        for sid, file in (edit.get("images") or {}).items():
            sh = by_id.get(int(sid))
            if sh is not None and is_screenshot(sh) and os.path.exists(file):
                replace_picture(slide, sh, file)
                changed += 1
    return changed


# ---------------------------------------------------------------- commands

def cmd_inspect(path):
    prs = Presentation(path)
    slides, kinds = analyse(prs)
    for i, (s, k) in enumerate(zip(slides, kinds), 1):
        shots = sum(1 for sh in s.shapes if is_screenshot(sh))
        extra = ""
        if k == "glance":
            extra = " cards=" + ", ".join(text_of(c).split("\n")[0] for c, _, _ in glance_cards(s))
        if k == "demo":
            extra = f" items={len(demo_items(s))}"
        notes = s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip()
        print(f"{i:>2} {k:<11} screenshots={shots}{' notes' if notes else ''}{extra} | {title_text(s)[:90]}")
    p, d = pick_templates(slides, kinds)
    print(f"\ntemplate purpose slide: {slides.index(p) + 1 if p else 'NOT FOUND'}")
    print(f"template demo slide:    {slides.index(d) + 1 if d else 'NOT FOUND'}")


def fill_purpose(slide, story):
    parts = purpose_parts(slide)
    set_story_title(slide, story["key"], story["title"])
    if "tag" in parts and story.get("tag"):
        set_single(parts["tag"], story["tag"])
    headline = story["headline"]
    if isinstance(headline, str):
        headline = [headline]
    set_runs(parts["headline"].text_frame.paragraphs[0], headline)
    set_after_label(parts["purpose"], "Purpose:", story["purpose"])
    set_after_label(parts["why"], "Why it matters:", story["why"])
    set_single(parts["improving"], story["improving"])
    for sh in list(slide.shapes):
        if is_screenshot(sh):
            remove_shape(sh)


def screenshot_region(slide, slide_width):
    """Where the template keeps its screenshots: the union of the old pictures, stretched to the right margin and footer."""
    boxes = [(sh.left, sh.top, sh.left + sh.width, sh.top + sh.height) for sh in slide.shapes if is_screenshot(sh)]
    margin = EMU_INCH * 35 // 100
    if not boxes:
        return slide_width // 2, HEADER_BOTTOM + margin, slide_width - margin, FOOTER_TOP - margin // 2
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    return left, top, max(max(b[2] for b in boxes), slide_width - margin), max(max(b[3] for b in boxes), FOOTER_TOP - margin // 2)


def place_screenshots(slide, region, files):
    """Stack up to 3 screenshots in the region, each scaled to fit with a thin border."""
    files = [f for f in files if os.path.exists(f)][:3]
    if not files:
        return 0
    left, top, right, bottom = region
    gap = EMU_INCH // 8
    cell_h = (bottom - top - gap * (len(files) - 1)) // len(files)
    width = right - left
    for i, f in enumerate(files):
        pic = slide.shapes.add_picture(f, left, top)
        ratio = pic.width / pic.height
        w, h = width, int(width / ratio)
        if h > cell_h:
            h, w = cell_h, int(cell_h * ratio)
        pic.width, pic.height = w, h
        pic.left = left + (width - w) // 2
        pic.top = top + i * (cell_h + gap) + (cell_h - h) // 2
        pic.line.color.rgb = RGBColor(0xD0, 0xD5, 0xDD)
        pic.line.width = Pt(0.75)
    return len(files)


def fill_demo(slide, story, slide_width=None):
    set_story_title(slide, story["key"], story["title"])
    tag = demo_tag(slide)
    if tag is not None and story.get("tag"):
        set_single(tag, story["tag"])
    region = screenshot_region(slide, slide_width) if slide_width and story.get("screenshots") else None
    for sh in list(slide.shapes):
        if is_screenshot(sh):
            remove_shape(sh)
    items = story["demo"]
    pairs = demo_items(slide)
    step = pairs[1][0].top - pairs[0][0].top if len(pairs) > 1 else 600075
    first_top = pairs[0][0].top
    text_offset = pairs[0][1].top - pairs[0][0].top
    if len(items) > 1:
        step = min(step, (FOOTER_TOP - first_top - pairs[-1][1].height) // (len(items) - 1))
    for g, t in pairs[len(items):]:
        remove_shape(g)
        remove_shape(t)
    pairs = pairs[:len(items)]
    while len(pairs) < len(items):
        proto_g, proto_t = pairs[-1]
        g_el, t_el = copy.deepcopy(proto_g._element), copy.deepcopy(proto_t._element)
        shift(g_el, step)
        shift(t_el, step)
        proto_t._element.addnext(g_el)
        g_el.addnext(t_el)
        renumber_ids(g_el, slide)
        renumber_ids(t_el, slide)
        pairs = demo_items(slide)
    for n, ((g, t), text) in enumerate(zip(pairs, items), 1):
        g.top = first_top + (n - 1) * step
        t.top = g.top + text_offset
        digit = next(s for s in g.shapes if s.has_text_frame and s.text_frame.text.strip().isdigit())
        set_single(digit, str(n))
        set_single(t, text)
    if region:
        place_screenshots(slide, region, story["screenshots"])


def fill_glance(prs, glance, stories, title=None):
    if title:
        set_runs(title_shape(glance).text_frame.paragraphs[0], [title])
    cards = glance_cards(glance)
    if not cards:
        return [glance]
    pages = [glance]
    remaining = list(stories)
    capacity = len(cards)
    while len(remaining) > capacity * len(pages):
        extra = clone_slide(prs, glance)
        move_slide(prs, extra, list(prs.slides).index(pages[-1]) + 1)
        pages.append(extra)
    for p, page in enumerate(pages):
        chunk = remaining[p * capacity:(p + 1) * capacity]
        page_cards = glance_cards(page)
        for (card, bar, badge), story in zip(page_cards, chunk):
            pars = card.text_frame.paragraphs
            set_runs(pars[0], [story["key"]])
            set_runs(pars[1], [story["title"]])
            if badge is not None and story.get("status"):
                set_single(badge, story["status"])
        for card, bar, badge in page_cards[len(chunk):]:
            for s in (card, bar, badge):
                if s is not None:
                    remove_shape(s)
    return pages


def cmd_build(path, content_path, out):
    with open(content_path, encoding="utf-8") as f:
        content = json.load(f)
    prs = Presentation(path)
    slides, kinds = analyse(prs)
    tpl_purpose, tpl_demo = pick_templates(slides, kinds)
    if tpl_purpose is None or tpl_demo is None:
        sys.exit("error: could not find a Purpose + WHAT WE'LL DEMO story slide pair to use as a template")

    intro_changes = apply_intro(slides, kinds, content.get("intro"))

    cover = content.get("cover") or {}
    if cover:
        cover_slide = slides[0]
        boxes = [s for s in cover_slide.shapes if s.has_text_frame and s.text_frame.text.strip()
                 and "Copyright" not in s.text_frame.text]
        boxes.sort(key=lambda s: s.top)
        if cover.get("title") and boxes:
            set_runs(boxes[0].text_frame.paragraphs[0], [cover["title"]])
        if cover.get("dates") and len(boxes) > 1:
            set_runs(boxes[1].text_frame.paragraphs[0], [cover["dates"]])

    glance = next((s for s, k in zip(slides, kinds) if k == "glance"), None)
    old_story = [s for s, k in zip(slides, kinds) if k in ("purpose", "demo", "story-other")]
    first_story_idx = slides.index(old_story[0]) if old_story else (slides.index(glance) + 1)

    stories = content["stories"]
    new_slides = []
    for story in stories:
        p = clone_slide(prs, tpl_purpose)
        fill_purpose(p, story)
        set_notes(p, story.get("purpose_notes"))
        d = clone_slide(prs, tpl_demo)
        fill_demo(d, story, prs.slide_width)
        set_notes(d, story.get("demo_notes"))
        new_slides += [p, d]

    for s in old_story:
        delete_slide(prs, s)
    if glance is not None:
        pages = fill_glance(prs, glance, stories, content.get("glance_title"))
        first_story_idx = list(prs.slides).index(pages[-1]) + 1
    for offset, s in enumerate(new_slides):
        move_slide(prs, s, first_story_idx + offset)

    prs.save(out)
    print(f"wrote {out}: {len(stories)} stories, {len(new_slides)} story slides, "
          f"removed {len(old_story)} old story slides, {intro_changes} opening-slide edits")


def cmd_strip(path, out):
    prs = Presentation(path)
    slides, kinds = analyse(prs)
    removed = 0
    for s, k in zip(slides, kinds):
        if k not in ("purpose", "demo", "story-other"):
            continue
        for sh in list(s.shapes):
            if is_screenshot(sh):
                remove_shape(sh)
                removed += 1
    prs.save(out)
    print(f"wrote {out}: removed {removed} screenshots")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["inspect"] and len(args) == 2:
        cmd_inspect(args[1])
    elif args[:1] == ["build"] and len(args) == 4:
        cmd_build(*args[1:])
    elif args[:1] == ["strip"] and len(args) == 3:
        cmd_strip(*args[1:])
    elif args[:1] == ["intro"] and len(args) == 3:
        cmd_intro(*args[1:])
    else:
        sys.exit(__doc__)
