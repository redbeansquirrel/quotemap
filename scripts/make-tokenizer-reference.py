"""Create reference IDs using upstream Tokenizers; no web calls or customer data."""
from pathlib import Path
import sys, json
ROOT = Path(__file__).resolve().parents[1]
CACHED = ROOT.parent.parent / 'parallel-2026-10-10/challenge'
sys.path.insert(0, str(CACHED / 'vendor'))
from tokenizers import Tokenizer

texts = [
    'Homepage design', 'Responsive website implementation', 'Email support for 30 days',
    'Website support for 7 days', 'Technical search engine optimisation',
    'Design & build: 5 pages, $1,250.50', 'A quote with "double quotes" and a comma, here.',
    'NO hosting included', 'Without hosting or a domain', 'mobile-friendly layout',
    'Café branding and naïve typography', 'Straße', '\tSame\nwords\rhere',
    'Menu\u00a0layout', 'Hello\u200bWorld', 'Support [MASK] days', '[CLS] [SEP] [PAD] [UNK]',
    '报价对齐与数量检查', 'A — B – C … D', 'Copyright © 2026',
    'Emoji U0001f60a layout', 'x' * 101, 'upload 10.5 pages', 'Email\x00support\ufffd',
    'Monthly / annual / one-time', 'SETUP then support', 'İstanbul design',
    'Polish lódź interface', '---___+++', 'Deliverable ' * 200,
]
tokenizer = Tokenizer.from_file(str(ROOT / 'dist/assets/tokenizer.json'))
tokenizer.enable_truncation(max_length=128)
cases = [{'text': text, 'ids': tokenizer.encode(text).ids} for text in texts]
(ROOT / 'scripts/tokenizer-reference.json').write_text(json.dumps({'reference': 'Hugging Face Tokenizers 0.22.2, pinned tokenizer JSON', 'cases': cases}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'referenceCases': len(cases)}, ensure_ascii=False))
