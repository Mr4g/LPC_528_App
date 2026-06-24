import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="operator-panel">
      <section className="card">
        <h1>LPC-528 Operator Panel</h1>
        <p>Szkielet aplikacji zastępującej flow Node-RED dla testera szczelności.</p>
        <label>
          Barcode
          <input placeholder="Zeskanuj lub wpisz barcode" />
        </label>
        <button type="button">Start programu (TODO)</button>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
