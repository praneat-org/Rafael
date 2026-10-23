import './style.css';
import { useSession } from './useSession';
import { EndView, LiveView, SetupView } from './views';

export function App() {
  const { state, offline, send } = useSession();
  if (offline) return <p className="note">เชื่อมต่อ offscreen ไม่ได้ — ปิดแล้วเปิด side panel ใหม่</p>;
  if (state.phase === 'live') return <LiveView state={state} send={send} />;
  if (state.phase === 'end') return <EndView send={send} />;
  return <SetupView send={send} />;
}
