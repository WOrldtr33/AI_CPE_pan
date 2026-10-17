"""Constrained pronunciation aliases; never accept Claude without Hi/嗨/嘿."""
import re

SEPARATOR = r'[\s,，。.!！?？:：、\-]*'
PHRASE = re.compile(r'(?<![a-z])(?:hi|嗨|嘿)' + SEPARATOR + r'(?:claude|cloud|clod|clode|克劳德|克洛德|克罗德)(?![a-z])', re.I)

def normalized(text):
    return re.sub(r'[^a-z0-9\u4e00-\u9fff]', '', text.lower())

def find_wake(text):
    match = PHRASE.search(text)
    if not match:
        return None
    # Reject explicit quoted descriptions rather than turning them into commands.
    before = text[:match.start()].strip().lower()
    if re.search(r'(?:他说|她说|唤醒词是|唤醒词叫|wake word is|say the words)[\s:："“]*$', before):
        return None
    return match

def aligned_span(text, tokens, times, match):
    if len(tokens) != len(times) or not times or normalized(''.join(tokens)) != normalized(text):
        return None
    first = len(normalized(text[:match.start()])); last = len(normalized(text[:match.end()]))
    count = 0; start = None; end = None
    for token, at in zip(tokens, times):
        next_count = count + len(normalized(token))
        if next_count > first and start is None:
            start = at
        if next_count >= last:
            end = at; break
        count = next_count
    if start is None or end is None:
        return None
    return max(0, start - 0.15), end + 0.35
