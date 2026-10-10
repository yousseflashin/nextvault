import { useState } from 'react';
import './main.css';

function App() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  
  if (hasToken === null) {
    return (
      <div className="container">
        <h1>NexVault Mobile</h1>
        <p>Do you already have a token?</p>
        <div className="card">
          <button onClick={() => setHasToken(false)}>No - I need a new token</button>
          <button className="secondary" onClick={() => setHasToken(true)}>Yes - I have a token</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>NexVault Mobile</h1>
      {hasToken ? (
        <div className="card">
          <h2>Existing Network</h2>
          <p>Scan or paste your Bootstrap Token JSON to join your secure device network.</p>
          <textarea placeholder='{"tokenId": "...", ...}' rows={4} style={{width: '100%'}}></textarea>
          <button style={{marginTop: '1rem'}}>Connect to Proxy</button>
        </div>
      ) : (
        <div className="card">
          <h2>New Network</h2>
          <p>We are generating your new secure local-first environment.</p>
          <button>Generate Application Token</button>
        </div>
      )}
    </div>
  );
}

export default App;