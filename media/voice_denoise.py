"""Conservative single-pass spectral denoising; no speaker separation or gain boost."""
import numpy as np

def denoise(samples, rate=16000):
    x=np.asarray(samples,dtype=np.float32)
    if len(x)<512:return x.copy()
    size,hop=512,128
    padded=np.pad(x,(size,size)); window=np.sqrt(np.hanning(size).astype(np.float32))
    frames=np.lib.stride_tricks.sliding_window_view(padded,size)[::hop].copy()
    spectrum=np.fft.rfft(frames*window,axis=1); power=np.abs(spectrum)**2
    # Conservative floor protects quiet consonants; never raise signal amplitude.
    noise=np.percentile(power,20,axis=0)*.5
    mask=np.sqrt(np.maximum(.36,1-noise[None,:]/np.maximum(power,1e-12)))
    freq=np.fft.rfftfreq(size,1/rate)
    mask[:,freq<65]*=freq[freq<65]/65
    restored=np.fft.irfft(spectrum*mask,n=size,axis=1)*window
    output=np.zeros(len(padded)); weights=np.zeros(len(padded))
    for i,frame in enumerate(restored):
        at=i*hop;output[at:at+size]+=frame;weights[at:at+size]+=window**2
    return np.clip(output[size:size+len(x)]/np.maximum(weights[size:size+len(x)],1e-8),-1,1).astype(np.float32)
