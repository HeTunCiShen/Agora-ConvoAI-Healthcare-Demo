// Audio Visualizer - Demo Feature for Agora ConvoAI
// This file contains the audio visualization functionality
// It's separated from app.js to keep the main Agora SDK integration clean

class AudioVisualizer {
  constructor() {
    this.volumeAnimationFrame = null;
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.isActive = false;
  }

  // Start frequency analysis and visualization
  startFrequencyAnalysis(audioTrack) {
    if (!audioTrack) {
      console.log('Audio track not available for visualization');
      return;
    }
    
    try {
      // Get the MediaStreamTrack from Agora's audio track
      const mediaStreamTrack = audioTrack.getMediaStreamTrack();
      const mediaStream = new MediaStream([mediaStreamTrack]);
      
      // Create audio context for frequency analysis
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      
      // Audio analysis settings optimized for voice
      this.analyser.fftSize = 512; // Higher resolution
      this.analyser.smoothingTimeConstant = 0.3; // Less smoothing for more responsiveness
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      
      source.connect(this.analyser);
      
      // Start the animation loop
      this.isActive = true;
      this.animateFrequencyBars();
      
      console.log('Audio visualizer: Frequency analysis started');
    } catch (error) {
      console.error('Audio visualizer: Failed to start frequency analysis:', error);
    }
  }
  
  // Stop frequency analysis and cleanup
  stopFrequencyAnalysis() {
    this.isActive = false;
    
    if (this.volumeAnimationFrame) {
      cancelAnimationFrame(this.volumeAnimationFrame);
      this.volumeAnimationFrame = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
      this.dataArray = null;
    }
    
    this.resetWaveBars();
    console.log('Audio visualizer: Stopped');
  }
  
  // Main animation loop
  animateFrequencyBars() {
    if (!this.isActive || !this.analyser || !this.dataArray) {
      console.log('Audio visualizer: Animation blocked - no audio analysis');
      return;
    }
    
    this.volumeAnimationFrame = requestAnimationFrame(() => this.animateFrequencyBars());
    
    this.analyser.getByteFrequencyData(this.dataArray);
    
    const bars = document.querySelectorAll('.wave-bar');
    if (!bars.length) return;
    
    // Debug: Log frequency data occasionally
    if (Math.random() < 0.01) { // 1% of the time
      const maxFreq = Math.max(...this.dataArray);
      const avgFreq = this.dataArray.reduce((a, b) => a + b) / this.dataArray.length;
      console.log('Audio visualizer: Frequency data', { maxFreq, avgFreq });
    }
    
    // Use different frequency ranges for each bar with better distribution
    bars.forEach((bar, index) => {
      // Better frequency distribution - use lower frequencies for more activity
      const freqStart = Math.floor(index * (this.dataArray.length / bars.length * 0.7)); // Focus on lower 70% of spectrum
      const freqEnd = Math.floor((index + 1) * (this.dataArray.length / bars.length * 0.7));
      
      // Get average frequency value in this range for smoother response
      let freqValue = 0;
      for (let i = freqStart; i <= freqEnd && i < this.dataArray.length; i++) {
        freqValue += this.dataArray[i];
      }
      freqValue = freqValue / (freqEnd - freqStart + 1);
      
      // Less aggressive normalization
      let normalizedValue = freqValue / 255;
      normalizedValue = Math.pow(normalizedValue, 0.7); // Less responsive curve
      normalizedValue = Math.min(normalizedValue * 1.8, 1); // Reduced amplification
      
      // Controlled height range for smooth effect  
      const minHeight = 15;
      const maxHeight = 60;
      const height = minHeight + (maxHeight - minHeight) * normalizedValue;
      
      // Smoothing for less jittery animation
      const smoothingFactor = 0.6;
      const currentHeight = parseInt(bar.style.height) || minHeight;
      const targetHeight = currentHeight * smoothingFactor + height * (1 - smoothingFactor);
      
      // Apply styles (override CSS animations)
      bar.style.setProperty('height', `${targetHeight}px`, 'important');
      bar.style.setProperty('opacity', `${0.7 + (normalizedValue * 0.3)}`, 'important');
      bar.style.animation = 'none';
    });
  }
  
  // Reset wave bars to default state
  resetWaveBars() {
    const bars = document.querySelectorAll('.wave-bar');
    bars.forEach(bar => {
      bar.style.height = '';
      bar.style.opacity = '';
      bar.style.animation = '';
    });
  }
  
  // Show visualizer UI
  show() {
    const visualizerEl = document.getElementById('ai-visualizer');
    if (visualizerEl) {
      visualizerEl.style.display = 'block';
    }
  }
  
  // Hide visualizer UI
  hide() {
    const visualizerEl = document.getElementById('ai-visualizer');
    if (visualizerEl) {
      visualizerEl.style.display = 'none';
    }
    this.stopFrequencyAnalysis();
  }
}

// Create global instance for use in app.js
window.audioVisualizer = new AudioVisualizer();