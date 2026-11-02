import React from 'react';
import Navbar from './components/Navbar.jsx';
import DeepWebHero from './components/DeepWebHero.jsx';
import BentoCapabilities from './components/BentoCapabilities.jsx';
import InteractiveArchitecture from './components/InteractiveArchitecture.jsx';
import DownloadsSection from './components/DownloadsSection.jsx';
import Footer from './components/Footer.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-dw-bg text-dw-text selection:bg-dw-green selection:text-black relative font-sans">
      <Navbar />
      <main>
        <DeepWebHero />
        <BentoCapabilities />
        <InteractiveArchitecture />
        <DownloadsSection />
      </main>
      <Footer />
    </div>
  );
}
