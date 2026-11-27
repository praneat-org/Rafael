import '../../extension/entrypoints/sidepanel/style.css';
import './web.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// biome-ignore lint/style/noNonNullAssertion: root exists in index.html
createRoot(document.getElementById('root')!).render(<App />);
