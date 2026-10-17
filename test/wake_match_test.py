import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'media'))
from wake_match import find_wake, aligned_span

class WakePronunciationTest(unittest.TestCase):
    def test_aliases_require_the_whole_phrase(self):
        for text in ['Hi Claude!', 'Hi, Cloud.', '嗨，克劳德。', '嘿克洛德', 'Hi克罗德', '背景说话。Hi Claude，请回答。']:
            self.assertIsNotNone(find_wake(text), text)
        for text in ['Claude', 'cloud', 'Hi there', 'high cloud cover', '吃饭了吗', '他说Hi Claude', '唤醒词是Hi Claude']:
            self.assertIsNone(find_wake(text), text)
    def test_reference_is_aligned_to_wake_only(self):
        text='Hi, Claude, are you there?'
        tokens=['H','i',',',' Cla','ude',',',' are',' you',' there','?']
        times=[.06,.18,.24,.36,.54,.66,.72,.84,.96,1.14]
        start,end=aligned_span(text,tokens,times,find_wake(text))
        self.assertEqual(start,0)
        self.assertAlmostEqual(end,.89)
        self.assertIsNone(aligned_span(text,['wrong'],[0],find_wake(text)))

if __name__ == '__main__':
    unittest.main()
