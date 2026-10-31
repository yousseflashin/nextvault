import React from 'react';
import Navbar from './components/Navbar.jsx';
import CyberShieldHero from './components/CyberShieldHero.jsx';
import FeaturesSection from './components/FeaturesSection.jsx';
import ArchitectureSection from './components/ArchitectureSection.jsx';
import DownloadsSection from './components/DownloadsSection.jsx';
import Footer from './components/Footer.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-nv-bg text-nv-text selection:bg-nv-primary selection:text-nv-bg relative">
      <Navbar />
      <main>
        <CyberShieldHero />
        <FeaturesSection />
        <ArchitectureSection />
        <DownloadsSection />
      </main>
      <Footer />
    </div>
  );
}

