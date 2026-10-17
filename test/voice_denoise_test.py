import sys
import unittest
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools/voice/packages'))
sys.path.insert(0,str(root/'media'))
import numpy as np
from voice_denoise import denoise

class DenoiseTest(unittest.TestCase):
 def test_length_finite_and_silent_input(self):
  for n in [160,512,16000,16037]:
   y=denoise(np.zeros(n,dtype=np.float32));self.assertEqual(len(y),n);self.assertTrue(np.isfinite(y).all());self.assertEqual(float(np.max(np.abs(y))),0)
 def test_low_hum_reduced_without_erasing_voice_band(self):
  t=np.arange(32000)/16000
  def amplitude(x,hz):return abs(np.sum(x*np.exp(-2j*np.pi*hz*t)))*2/len(x)
  x=(.07*np.sin(2*np.pi*30*t)+.03*np.sin(2*np.pi*1000*t)).astype(np.float32);y=denoise(x)
  self.assertLess(amplitude(y,30),amplitude(x,30)*.65)
  self.assertGreater(amplitude(y,1000),amplitude(x,1000)*.60)
  self.assertLessEqual(np.max(np.abs(y)),1)
if __name__=='__main__':unittest.main()
