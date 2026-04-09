import React, { useState, useRef, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, query, onSnapshot, deleteDoc } from 'firebase/firestore';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { 
  Trophy, Utensils, Scale, Calendar, Plus, ChevronRight, 
  Target, Zap, Clock, Info, AlertCircle, Save, Brain, Camera, X, User, Activity, Edit3, Trash2
} from 'lucide-react';

// --- Firebase 設定 ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'athlete-hub-final';

// --- 東京時間ユーティリティ ---
const getTodayJST = () => {
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return jstDate.toISOString().split('T')[0];
};

const getCurrentTimeJST = () => {
  const now = new Date();
  const jstTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const hours = String(jstTime.getHours()).padStart(2, '0');
  const minutes = String(jstTime.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const App = () => {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // 各種データ
  const [profile, setProfile] = useState({ age: "", height: "", startWeight: "", targetWeight: "", lifestyle: "", improvementPoints: "" });
  const [weightData, setWeightData] = useState([]);
  const [meals, setMeals] = useState([]);
  const [matches, setMatches] = useState([]);

  // 入力フォーム（下書き機能のために一括管理）
  const [inputs, setInputs] = useState({
    weight: { weight: "", date: getTodayJST() },
    meal: { name: "", calories: "", image: null, imageFile: null, date: getTodayJST(), time: getCurrentTimeJST() },
    match: { title: "", date: "", time: "", location: "" }
  });

  // UI管理
  const [modalType, setModalType] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  
  const fileInputRef = useRef(null);

  // 1. Firebase 認証 (RULE 3)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth failed:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. データのリアルタイム取得 (RULE 1 & 2)
  useEffect(() => {
    if (!user || firebaseConfig.apiKey === "dummy") return;

    // プロフィール & 下書き復元
    getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'profile')).then(snap => snap.exists() && setProfile(snap.data()));
    getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'drafts')).then(snap => snap.exists() && setInputs(prev => ({ ...prev, ...snap.data() })));

    // 体重 (古い順：グラフ用)
    const unsubWeights = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'weights'), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setWeightData(data.sort((a, b) => new Date(a.date) - new Date(b.date)));
    }, err => console.error(err));

    // 食事 (新しい順：履歴用)
    const unsubMeals = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'meals'), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const normalized = data
        .filter(m => m && typeof m === 'object')
        .map(m => ({
          ...m,
          date: typeof m.date === 'string' && m.date ? m.date : getTodayJST(),
          time: typeof m.time === 'string' && m.time ? m.time : '00:00',
          name: typeof m.name === 'string' ? m.name : '',
          image: typeof m.image === 'string' ? m.image : null
        }));

      setMeals(normalized.sort((a, b) => {
        const bTime = new Date(`${b.date}T${b.time}`).getTime();
        const aTime = new Date(`${a.date}T${a.time}`).getTime();
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }));
    }, err => console.error(err));

    // 予定 (新しい順)
    const unsubMatches = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'matches'), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMatches(data.sort((a, b) => new Date(a.date) - new Date(b.date)));
    }, err => console.error(err));

    return () => { unsubWeights(); unsubMeals(); unsubMatches(); };
  }, [user]);

  // 下書き自動保存 (デバウンス)
  useEffect(() => {
    if (!user) return;
    const saveDraft = async () => {
      // imageFileなどのシリアライズ不可能なものは除外
      const draftToSave = JSON.parse(JSON.stringify(inputs));
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'drafts'), draftToSave);
    };
    const timer = setTimeout(saveDraft, 1000);
    return () => clearTimeout(timer);
  }, [inputs, user]);

  // --- 保存アクション ---
  const handleSaveProfile = async () => {
    if (!user) return;
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'profile'), profile);
    alert("クラウドに保存されました。");
  };

  const handleSaveWeight = async () => {
    if (!user || !inputs.weight.weight) return;
    const data = { weight: parseFloat(inputs.weight.weight), date: inputs.weight.date };
    const ref = editingItem ? doc(db, 'artifacts', appId, 'users', user.uid, 'weights', editingItem.id) : doc(collection(db, 'artifacts', appId, 'users', user.uid, 'weights'));
    await setDoc(ref, data);
    closeModals();
  };

  const handleSaveMeal = async () => {
    if (!user || (!inputs.meal.name && !inputs.meal.image)) return;
    const data = { ...inputs.meal, calories: 0 };
    delete data.imageFile;
    const ref = editingItem ? doc(db, 'artifacts', appId, 'users', user.uid, 'meals', editingItem.id) : doc(collection(db, 'artifacts', appId, 'users', user.uid, 'meals'));
    await setDoc(ref, data);
    closeModals();
  };

  const handleSaveMatch = async () => {
    if (!user || !inputs.match.title) return;
    const ref = editingItem ? doc(db, 'artifacts', appId, 'users', user.uid, 'matches', editingItem.id) : doc(collection(db, 'artifacts', appId, 'users', user.uid, 'matches'));
    await setDoc(ref, inputs.match);
    closeModals();
  };

  const deleteItem = async (type, id) => {
    if (!user || !window.confirm("削除しますか？")) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, `${type}s`, id));
  };

  const closeModals = () => {
    setModalType(null);
    setEditingItem(null);
  };

  const openEditModal = (type, item) => {
    setEditingItem(item);
    setModalType(type);
    setInputs(prev => ({ ...prev, [type]: { ...item } }));
  };

  const openNewModal = (type) => {
    setEditingItem(null);
    setModalType(type);
    // 新規登録時はフォームをリセット
    const defaultInputs = {
      weight: { weight: "", date: getTodayJST() },
      meal: { name: "", calories: "", image: null, imageFile: null, date: getTodayJST(), time: getCurrentTimeJST() },
      match: { title: "", date: "", time: "", location: "" }
    };
    setInputs(prev => ({ ...prev, [type]: defaultInputs[type] }));
  };

  const getPlanPhase = (daysUntilMatch) => {
    if (daysUntilMatch !== null && daysUntilMatch <= 2) return '調整期';
    if (daysUntilMatch !== null && daysUntilMatch <= 7) return '準備期';
    return '通常期';
  };

  const getTodayDateString = () => new Date().toISOString().slice(0, 10);

  const parseMinutes = (hhmm) => {
    if (!hhmm || !hhmm.includes(':')) return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };

  const formatMinutes = (minutes) => {
    if (!Number.isFinite(minutes)) return '--:--';
    const normalized = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = String(Math.floor(normalized / 60)).padStart(2, '0');
    const m = String(normalized % 60).padStart(2, '0');
    return `${h}:${m}`;
  };

  const getWeightTrend = () => {
    if (!weightData.length) return { diffToTarget: 0, trend7d: 0 };
    const current = weightData[weightData.length - 1].weight;
    const target = parseFloat(profile.targetWeight || 0) || current;
    const last7 = weightData.slice(-7).map(w => w.weight);
    const avg7 = last7.length ? last7.reduce((s, v) => s + v, 0) / last7.length : current;
    return { diffToTarget: current - target, trend7d: current - avg7 };
  };

  const analyzeMealPattern = () => {
    const recentNames = meals.slice(0, 10).map(m => (m.name || '').toLowerCase());
    const proteinLack = !recentNames.some(n => /(鶏|魚|卵|豆腐|納豆|ツナ|鮭|さば|肉|豚|牛)/.test(n));
    const vegLack = !recentNames.some(n => /(野菜|サラダ|ブロッコリー|ほうれん草|キャベツ|トマト|きのこ)/.test(n));
    const breakfastCount = meals.slice(0, 14).filter(m => (m.time || '00:00') < '10:30').length;
    return { proteinLack, vegLack, breakfastLack: breakfastCount < 3 };
  };

  const buildMeal = (time, title, items, ingredients) => ({ time, title, items, ingredients });

  const buildDailyPlan = () => {
    const weight = getWeightTrend();
    const mealPattern = analyzeMealPattern();
    const phase = getPlanPhase(daysUntil);

    const nextMatchTime = parseMinutes(nextM?.time);
    const isMatchDay = !!nextM && nextM.date === getTodayDateString();

    const riceDelta = weight.diffToTarget > 1 ? -20 : weight.diffToTarget < -1 ? 20 : 0;
    const baseRice = Math.max(120, 160 + riceDelta);
    const prepRice = Math.max(140, 180 + riceDelta);

    let breakfast = buildMeal(
      '07:00',
      'バランス朝食',
      [
        `ごはん ${baseRice}g`,
        '卵焼き 1個(約60g)',
        '納豆 1パック(45g)',
        '味噌汁 1杯(250ml)',
        'バナナ 1本(100g)'
      ],
      ['米', '卵', '納豆', '豆腐/わかめ', 'バナナ']
    );

    let lunch = buildMeal(
      '12:30',
      '鶏むね丼セット',
      [
        `ごはん ${baseRice + 20}g`,
        '鶏むね肉 120g',
        '温野菜 150g',
        '具だくさんスープ 250ml'
      ],
      ['米', '鶏むね肉', 'ブロッコリー/にんじん', '玉ねぎ/きのこ']
    );

    let dinner = buildMeal(
      '19:00',
      '魚メイン定食',
      [
        `ごはん ${Math.max(120, baseRice - 10)}g`,
        '鮭 100g',
        '冷奴 120g',
        '野菜副菜 150g',
        '味噌汁 1杯(250ml)'
      ],
      ['米', '鮭', '豆腐', '葉物野菜', '味噌']
    );

    let snack = {
      timing: '16:00 / 21:00',
      options: [
        'おにぎり 1個(100g)',
        'inゼリー エネルギー 1個',
        'バナナ 1本 + 牛乳200ml',
        'カステラ 2切れ + 水'
      ]
    };

    if (phase === '準備期') {
      breakfast = buildMeal(
        '06:45',
        'エネルギー強化朝食',
        [`ごはん ${prepRice}g`, '納豆 1パック(45g)', '卵 1個(60g)', '味噌汁 250ml', 'ヨーグルト 100g'],
        ['米', '納豆', '卵', '味噌', '乳製品']
      );
      lunch = buildMeal(
        '12:30',
        '親子丼セット',
        [`ごはん ${prepRice + 20}g`, '鶏もも肉 120g', '卵 1個(60g)', 'サラダ 120g', '果物 100g'],
        ['米', '鶏肉', '卵', '葉物野菜', '果物']
      );
      dinner = buildMeal(
        '19:00',
        '回復メニュー',
        [`ごはん ${prepRice}g`, '鮭 100g', 'ささみ 80g', '温野菜 150g', 'スープ 250ml'],
        ['米', '鮭', '鶏ささみ', 'ブロッコリー/にんじん', '玉ねぎ']
      );
      snack = {
        timing: '15:30 / 20:30',
        options: [
          'おにぎり 1個(100g)',
          'inゼリー エネルギー 1個',
          'どら焼き 1個 + 牛乳200ml',
          'あんパン 1個 + 水'
        ]
      };
    }

    if (phase === '調整期') {
      breakfast = buildMeal(
        '07:00',
        '消化優先朝食',
        ['おかゆ 250g', '卵 1個(60g)', '味噌汁 200ml', 'バナナ 1本(100g)'],
        ['米', '卵', '味噌', 'バナナ']
      );
      lunch = buildMeal(
        '12:00',
        '消化しやすい昼食',
        ['うどん 1玉(250g)', '鶏むね肉 90g', 'ほうれん草 60g', '汁 250ml'],
        ['うどん', '鶏むね肉', 'ほうれん草', 'だし']
      );
      dinner = buildMeal(
        '18:30',
        '前日調整夕食',
        [`白米 ${Math.max(130, baseRice)}g`, '白身魚 100g', '豆腐 100g', 'にんじん 60g', '汁物 200ml'],
        ['米', '白身魚', '豆腐', 'にんじん', '味噌']
      );
      snack = {
        timing: '15:00 / 20:00',
        options: [
          'inゼリー エネルギー 1個',
          'おにぎり(塩) 1個(100g)',
          'カステラ 2切れ',
          'スポーツドリンク 300ml'
        ]
      };
    }

    let matchDayGuide = null;
    if (isMatchDay) {
      if (nextMatchTime === null) {
        matchDayGuide = {
          title: '試合日タイムテーブル',
          note: '試合時刻が未登録です。予定に時刻を入れると食事時刻を自動計算します。',
          timeline: [
            { label: '試合4時間前', time: '（試合時刻未設定）', plan: '主食中心の食事をしっかり' },
            { label: '試合2時間前', time: '（試合時刻未設定）', plan: 'おにぎり or inゼリーで補食' },
            { label: '試合後30分以内', time: '（試合時刻未設定）', plan: '牛乳 + バナナで回復開始' }
          ]
        };
      } else {
        matchDayGuide = {
          title: `試合日タイムテーブル（試合 ${nextM.time} 開始）`,
          note: '試合時刻から逆算した推奨です。',
          timeline: [
            { label: '試合4時間前', time: formatMinutes(nextMatchTime - 240), plan: 'ごはん200g + 鶏むね100g + 味噌汁' },
            { label: '試合2時間前', time: formatMinutes(nextMatchTime - 120), plan: 'おにぎり1個 or inゼリー1個' },
            { label: '試合60分前', time: formatMinutes(nextMatchTime - 60), plan: 'スポドリ200-300ml' },
            { label: '試合後30分以内', time: formatMinutes(nextMatchTime + 30), plan: '牛乳200ml + バナナ1本' }
          ]
        };
      }
    }

    const reasons = [
      phase === '調整期' ? '試合直前のため、消化しやすさを優先しています。' : phase === '準備期' ? '試合準備のため、エネルギー確保を重視しています。' : '通常期のため、体重管理と栄養バランスを重視しています。'
    ];
    if (Math.abs(weight.diffToTarget) >= 0.5) reasons.push(`目標体重との差 ${weight.diffToTarget > 0 ? '+' : ''}${weight.diffToTarget.toFixed(1)}kg を反映しています。`);
    if (Math.abs(weight.trend7d) >= 0.3) reasons.push(`直近7日トレンド ${weight.trend7d > 0 ? '+' : ''}${weight.trend7d.toFixed(1)}kg を考慮しています。`);
    if (mealPattern.proteinLack) reasons.push('直近の記録でたんぱく質が少ないため、主菜を強化しています。');
    if (mealPattern.vegLack) reasons.push('野菜不足を補うため、副菜を増やしています。');
    if (mealPattern.breakfastLack) reasons.push('朝食欠食の傾向があるため、朝に簡単な定番メニューを提案しています。');

    return { phase, breakfast, lunch, dinner, snack, reasons, matchDayGuide };
  };

  // --- 計算 ---
  const currentW = weightData[weightData.length - 1]?.weight || null;
  const nextM = matches.find(m => new Date(m.date) >= new Date().setHours(0,0,0,0)) || null;
  const daysUntil = nextM ? Math.ceil((new Date(nextM.date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
  const todayTotalCals = meals.filter(m => m.date === getTodayJST()).reduce((s, m) => s + (m.calories || 0), 0);
  const dailyPlan = buildDailyPlan();

  const NavButton = ({ active, onClick, icon, label }) => (
    <button onClick={onClick} className={`flex flex-col items-center justify-center flex-1 transition-all ${active ? 'text-blue-600 scale-105 font-black' : 'text-slate-400 opacity-60'}`}>
      <div className={`p-1.5 rounded-xl ${active ? 'bg-blue-50' : ''}`}>{icon}</div>
      <span className="text-[10px] mt-0.5 font-bold uppercase">{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 bg-slate-100 flex justify-center items-start md:p-8 overflow-hidden font-sans">
      <div className="w-full max-w-md h-full md:h-[844px] bg-white shadow-2xl relative flex flex-col md:rounded-[40px] overflow-hidden border border-slate-200">
        
        {/* 固定ヘッダー */}
        <header className="shrink-0 bg-white/95 backdrop-blur-md px-6 py-4 flex justify-between items-center border-b border-slate-100 z-30">
          <div className="cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <h1 className="text-lg font-black tracking-tighter text-slate-800 leading-none">ATHLETE HUB</h1>
            <p className="text-[10px] font-bold text-blue-500 uppercase mt-1 tracking-widest">Cross-Device</p>
          </div>
          <div className="flex flex-col items-end">
            <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100"><Target className="w-5 h-5" /></div>
          </div>
        </header>

        {/* メインスクロール */}
        <main className="flex-1 overflow-y-auto bg-slate-50/50 scrollbar-hide">
          <div className="p-5 space-y-6 pb-32">
            {activeTab === 'dashboard' && (
              <div className="space-y-6 animate-in fade-in">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-600 text-white p-5 rounded-[32px] shadow-lg relative overflow-hidden">
                    <Scale className="absolute -right-2 -bottom-2 w-16 h-16 opacity-10" />
                    <p className="text-[10px] font-bold opacity-80 mb-1 uppercase tracking-wider">Current Weight</p>
                    <div className="flex items-baseline gap-1 font-black"><span className="text-3xl">{currentW || '--'}</span><span className="text-xs opacity-80">kg</span></div>
                  </div>
                  <div className="bg-orange-500 text-white p-5 rounded-[32px] shadow-lg relative overflow-hidden">
                    <Trophy className="absolute -right-2 -bottom-2 w-16 h-16 opacity-10" />
                    <p className="text-[10px] font-bold opacity-80 mb-1 uppercase tracking-wider">Next Match</p>
                    <div className="flex items-baseline gap-1 font-black"><span className="text-3xl">{daysUntil ?? '--'}</span><span className="text-xs opacity-80">Days</span></div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-black text-slate-800 flex items-center gap-2 tracking-tighter uppercase"><Zap className="w-4 h-4 text-yellow-500" />Weight trend</h3>
                    <button onClick={() => openNewModal('weight')} className="text-[10px] font-black bg-blue-600 text-white px-3 py-1.5 rounded-full shadow-md">+ Add</button>
                  </div>
                  <div className="h-44 w-full">
                    {weightData.length > 1 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={weightData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="date" tickFormatter={v => v.split('-').slice(1).join('/')} axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8'}} />
                          <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                          <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }} />
                          {profile.targetWeight && <ReferenceLine y={parseFloat(profile.targetWeight)} stroke="#ef4444" strokeDasharray="3 3" />}
                          <Line type="monotone" dataKey="weight" stroke="#2563eb" strokeWidth={5} dot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl text-xs font-black">データが不足しています</div>
                    )}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                  <h3 className="font-black text-slate-800 tracking-tighter uppercase mb-4">Weight History</h3>
                  <div className="space-y-2">
                    {weightData.length > 0 ? (
                      [...weightData].reverse().map(w => (
                        <div key={w.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl group hover:bg-blue-50 transition-colors">
                          <div className="flex flex-col">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide">{w.date.split('-').reverse().join('/')}</div>
                            <div className="text-lg font-black text-blue-600">{w.weight} kg</div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEditModal('weight', w)} className="p-2 text-slate-300 hover:text-blue-500 active:scale-75 transition-all"><Edit3 className="w-4 h-4" /></button>
                            <button onClick={() => deleteItem('weight', w.id)} className="p-2 text-slate-300 hover:text-red-500 active:scale-75 transition-all"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-slate-300 opacity-30 uppercase tracking-widest"><Scale className="w-8 h-8 mx-auto mb-2" /><p className="text-xs font-black">No weight records</p></div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'meals' && (() => {
              const mealsByDate = {};
              meals.forEach(m => {
                const dateKey = typeof m?.date === 'string' && m.date ? m.date : getTodayJST();
                if (!mealsByDate[dateKey]) mealsByDate[dateKey] = [];
                mealsByDate[dateKey].push(m);
              });
              const sortedDates = Object.keys(mealsByDate).sort((a, b) => {
                const aTime = new Date(a).getTime();
                const bTime = new Date(b).getTime();
                return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
              });
              return (
                <div className="space-y-4 animate-in slide-in-from-bottom-4">
                  <div className="bg-slate-900 rounded-[32px] p-6 text-white shadow-xl flex justify-between items-center relative overflow-hidden">
                    <Brain className="absolute -right-4 -bottom-4 w-24 h-24 opacity-10" />
                    <div><h3 className="font-black text-xl leading-none tracking-tighter uppercase">Meal Log</h3></div>
                    <button onClick={() => openNewModal('meal')} className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg active:scale-90 transition-all z-10"><Plus className="w-6 h-6" /></button>
                  </div>
                  <div className="space-y-6">
                    {sortedDates.length > 0 ? sortedDates.map(date => {
                      const dayMeals = mealsByDate[date];
                      const dateStr = typeof date === 'string' && date.includes('-')
                        ? date.split('-').reverse().join('/')
                        : String(date);
                      return (
                        <div key={date} className="space-y-3">
                          <div className="px-1 py-3 flex justify-between items-center border-b-2 border-slate-200">
                            <span className="font-black text-slate-700 text-sm uppercase">{dateStr}</span>
                          </div>
                          {dayMeals.sort((a, b) => String(b?.time ?? '00:00').localeCompare(String(a?.time ?? '00:00'))).map((m, i) => (
                            <div key={m?.id || `${date}-${i}`} className="bg-white p-4 rounded-3xl flex items-center justify-between border border-slate-100 shadow-sm group hover:shadow-md transition-shadow">
                              <div className="flex items-center gap-4">
                                {m?.image ? <img src={m.image} className="w-14 h-14 rounded-2xl object-cover" /> : <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center text-green-600"><Utensils className="w-5 h-5" /></div>}
                                <div>
                                  <div className="text-[9px] font-black text-slate-300 uppercase">{String(m?.time ?? '--:--')}</div>
                                  <p className="text-sm font-black text-slate-700 leading-tight">{m?.name || '記録なし'}</p>
                                </div>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button onClick={() => openEditModal('meal', m)} className="p-2 text-slate-300 hover:text-blue-500 active:scale-75 transition-all"><Edit3 className="w-4 h-4" /></button>
                                <button onClick={() => m?.id && deleteItem('meal', m.id)} className="p-2 text-slate-300 hover:text-red-500 active:scale-75 transition-all"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }) : <div className="text-center py-24 text-slate-300 opacity-30 uppercase tracking-widest"><Utensils className="w-10 h-10 mx-auto mb-2" /><p className="text-xs font-black">No meal records</p></div>}
                  </div>
                </div>
              );
            })()}

            {activeTab === 'planPlus' && (
              <div className="space-y-4 animate-in fade-in">
                <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-black text-slate-800 tracking-tight uppercase">Today Plan</h3>
                    <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-blue-50 text-blue-600">{dailyPlan.phase}</span>
                  </div>
                  {[dailyPlan.breakfast, dailyPlan.lunch, dailyPlan.dinner].map((meal, idx) => (
                    <div key={idx} className="bg-slate-50 rounded-2xl p-4 mb-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-black text-slate-800">{meal.title}</p>
                        <span className="text-[10px] font-black text-blue-600 bg-blue-100 px-2 py-1 rounded-full">{meal.time}</span>
                      </div>
                      <p className="text-[10px] font-black text-slate-400 mb-1 uppercase">献立（グラム目安）</p>
                      <ul className="space-y-1 mb-2">
                        {meal.items.map((item, i) => (
                          <li key={i} className="text-xs font-bold text-slate-700">・{item}</li>
                        ))}
                      </ul>
                      <p className="text-[10px] font-black text-slate-400 mb-1 uppercase">おすすめ具材</p>
                      <p className="text-xs font-bold text-slate-600">{meal.ingredients.join(' / ')}</p>
                    </div>
                  ))}

                  <div className="bg-green-50 rounded-2xl p-4 text-green-800">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-black">補食（高校生向け・手軽）</p>
                      <span className="text-[10px] font-black bg-green-200 px-2 py-1 rounded-full">{dailyPlan.snack.timing}</span>
                    </div>
                    <ul className="space-y-1">
                      {dailyPlan.snack.options.map((item, i) => (
                        <li key={i} className="text-xs font-bold">・{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {dailyPlan.matchDayGuide && (
                  <div className="bg-orange-50 rounded-[32px] border border-orange-100 shadow-sm p-6">
                    <h4 className="font-black text-orange-800 mb-1 uppercase tracking-tight">{dailyPlan.matchDayGuide.title}</h4>
                    <p className="text-xs font-bold text-orange-700 mb-3">{dailyPlan.matchDayGuide.note}</p>
                    <div className="space-y-2">
                      {dailyPlan.matchDayGuide.timeline.map((slot, idx) => (
                        <div key={idx} className="bg-white rounded-2xl p-3 border border-orange-100">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-black text-slate-700">{slot.label}</span>
                            <span className="text-[10px] font-black text-orange-700">{slot.time}</span>
                          </div>
                          <p className="text-xs font-bold text-slate-600">{slot.plan}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-6">
                  <h4 className="font-black text-slate-800 mb-3 uppercase tracking-tight">Reason</h4>
                  <div className="space-y-2">
                    {dailyPlan.reasons.map((reason, idx) => (
                      <div key={idx} className="text-xs font-bold text-slate-600 bg-slate-50 rounded-2xl p-3">{reason}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'schedule' && (
              <div className="space-y-4 animate-in slide-in-from-right-4">
                <div className="flex justify-between items-center px-1"><h3 className="text-xl font-black text-slate-800 tracking-tighter uppercase">Schedule</h3><button onClick={() => openNewModal('match')} className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg active:scale-95">+ Add</button></div>
                {matches.length > 0 ? (
                  matches.map(m => (
                    <div key={m.id} className="bg-white p-5 rounded-[32px] border border-slate-100 shadow-sm flex gap-4 items-center group hover:shadow-md transition-shadow">
                      <div className="flex flex-col items-center min-w-[50px] border-r border-slate-100 pr-4 font-black">
                        <span className="text-[10px] text-blue-600 uppercase leading-none mb-1">{new Date(m.date).getMonth()+1}月</span>
                        <span className="text-2xl text-slate-800">{new Date(m.date).getDate()}</span>
                      </div>
                      <div className="flex-1 min-w-0"><h4 className="font-black text-slate-700 truncate">{m.title}</h4><p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{m.time || '--:--'} / {m.location || 'No location'}</p></div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEditModal('match', m)} className="p-2 text-slate-300 hover:text-blue-500 active:scale-75 transition-all"><Edit3 className="w-4 h-4" /></button>
                        <button onClick={() => deleteItem('match', m.id)} className="p-2 text-slate-300 hover:text-red-500 active:scale-75 transition-all"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-16 text-slate-300 opacity-30 uppercase tracking-widest"><Calendar className="w-10 h-10 mx-auto mb-2" /><p className="text-xs font-black">No schedule</p></div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 pb-12">
                <div className="bg-white rounded-[40px] p-7 shadow-sm border border-slate-100 space-y-6">
                  <div className="grid grid-cols-2 gap-5">
                    <div><label className="text-[10px] font-black text-slate-300 mb-1 block uppercase tracking-widest">Age</label><input type="number" value={profile.age} onChange={e => setProfile({...profile, age: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl border-none font-black text-base" /></div>
                    <div><label className="text-[10px] font-black text-slate-300 mb-1 block uppercase tracking-widest">Height</label><input type="number" value={profile.height} onChange={e => setProfile({...profile, height: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl border-none font-black text-base" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-5">
                    <div><label className="text-[10px] font-black text-slate-300 mb-1 block uppercase tracking-widest">Start Weight</label><input type="number" value={profile.startWeight} onChange={e => setProfile({...profile, startWeight: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl border-none font-black text-base" /></div>
                    <div><label className="text-[10px] font-black text-blue-500 mb-1 block uppercase tracking-widest">Goal</label><input type="number" value={profile.targetWeight} onChange={e => setProfile({...profile, targetWeight: e.target.value})} className="w-full p-4 bg-blue-50 rounded-2xl border-none font-black text-base text-blue-600" /></div>
                  </div>
                  <div><label className="text-[10px] font-black text-slate-300 mb-1 block uppercase tracking-widest">Lifestyle</label><input type="text" value={profile.lifestyle} onChange={e => setProfile({...profile, lifestyle: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl border-none font-black text-base" /></div>
                  <div><label className="text-[10px] font-black text-slate-300 mb-1 block uppercase tracking-widest">Points to improve</label><textarea value={profile.improvementPoints} onChange={e => setProfile({...profile, improvementPoints: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl border-none text-base min-h-[100px] font-black" /></div>
                  <button onClick={handleSaveProfile} className="w-full py-4 bg-slate-900 text-white font-black rounded-[24px] shadow-xl active:scale-95 transition-all uppercase tracking-widest text-sm">Save to Cloud</button>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* 固定ボトムナビ */}
        <nav className="shrink-0 bg-white border-t border-slate-100 px-3 h-20 flex items-center z-40 pb-5">
          <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Target className="w-5 h-5" />} label="HOME" />
          <NavButton active={activeTab === 'meals'} onClick={() => setActiveTab('meals')} icon={<Utensils className="w-5 h-5" />} label="MEALS" />
          <NavButton active={activeTab === 'planPlus'} onClick={() => setActiveTab('planPlus')} icon={<Calendar className="w-5 h-5" />} label="PLAN+" />
          <NavButton active={activeTab === 'schedule'} onClick={() => setActiveTab('schedule')} icon={<Clock className="w-5 h-5" />} label="PLAN" />
          <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<User className="w-5 h-5" />} label="USER" />
        </nav>

        {/* モーダル */}
        {modalType && (
          <div className="absolute inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6 px-8 overflow-hidden">
            <div className="bg-white w-full max-w-sm rounded-[44px] p-8 shadow-2xl relative flex flex-col gap-6 animate-in zoom-in-95 max-h-[90%] overflow-y-auto scrollbar-hide">
              <button onClick={closeModals} className="absolute top-7 right-7 p-2 bg-slate-50 rounded-full text-slate-400 z-50"><X className="w-5 h-5" /></button>
              <h3 className="text-xl font-black uppercase text-slate-800 tracking-tighter">{editingItem ? 'Edit' : 'Add'} {modalType}</h3>
              
              <div className="space-y-4">
                {modalType === 'weight' && (
                  <>
                    <input type="date" value={inputs.weight.date} onChange={e => setInputs({...inputs, weight: {...inputs.weight, date: e.target.value}})} className="w-full p-4 bg-slate-100 rounded-2xl font-black text-base" />
                    <input type="number" step="0.1" value={inputs.weight.weight} onChange={e => setInputs({...inputs, weight: {...inputs.weight, weight: e.target.value}})} className="w-full text-4xl font-black p-7 bg-slate-50 rounded-[32px] text-center text-blue-600 font-sans" placeholder="00.0" autoFocus />
                    <button onClick={handleSaveWeight} className="w-full py-5 bg-blue-600 text-white font-black rounded-3xl uppercase tracking-widest text-sm active:scale-95 shadow-lg">Confirm</button>
                  </>
                )}

                {modalType === 'meal' && (
                  <>
                    <div className="flex justify-center relative">
                      <div className="w-32 h-32 bg-slate-50 rounded-[32px] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center overflow-hidden relative group cursor-pointer" onClick={() => fileInputRef.current.click()}>
                        {inputs.meal.image ? (
                          <img src={inputs.meal.image} className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="w-8 h-8 text-slate-300" />
                        )}
                      </div>
                      {inputs.meal.image && (
                        <button onClick={(e) => { e.stopPropagation(); setInputs({...inputs, meal: {...inputs.meal, image: null, imageFile: null}}); }} className="absolute -top-2 right-4 bg-red-500 text-white p-1.5 rounded-full shadow-lg border-4 border-white"><X className="w-4 h-4" /></button>
                      )}
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
                        const file = e.target.files[0];
                        if(file) setInputs({...inputs, meal: {...inputs.meal, image: URL.createObjectURL(file), imageFile: file}});
                      }} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input type="date" value={inputs.meal.date} onChange={e => setInputs({...inputs, meal: {...inputs.meal, date: e.target.value}})} className="p-4 bg-slate-100 rounded-2xl font-black text-xs" />
                  return { phase, breakfast, lunch, dinner, snack, reasons, matchDayGuide };
                    </div>
                    <input type="text" value={inputs.meal.name} onChange={e => setInputs({...inputs, meal: {...inputs.meal, name: e.target.value}})} className="w-full p-4 bg-slate-100 rounded-2xl font-black text-base" placeholder="Menu name" />
                    <button onClick={handleSaveMeal} className="w-full py-5 bg-blue-600 text-white font-black rounded-3xl uppercase tracking-widest text-sm active:scale-95 shadow-lg">SAVE MEAL</button>
                  </>
                )}

                {modalType === 'match' && (
                  <>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date / Start Time</label>
                    <div className="grid grid-cols-2 gap-3">
                      <input type="date" value={inputs.match.date} onChange={e => setInputs({...inputs, match: {...inputs.match, date: e.target.value}})} className="w-full p-4 bg-slate-100 rounded-2xl font-black text-base" />
                      <input type="time" value={inputs.match.time || ''} onChange={e => setInputs({...inputs, match: {...inputs.match, time: e.target.value}})} className="w-full p-4 bg-slate-100 rounded-2xl font-black text-base" />
                    </div>
                    <input type="text" value={inputs.match.title} onChange={e => setInputs({...inputs, match: {...inputs.match, title: e.target.value}})} className="w-full p-4 bg-slate-100 rounded-2xl font-black text-base" placeholder="Match title" />
                    <input type="text" value={inputs.match.location} onChange={e => setInputs({...inputs, match: {...inputs.match, location: e.target.value}})} className="w-full p-4 bg-slate-100 rounded-2xl font-black text-base" placeholder="Location" />
                    <button onClick={handleSaveMatch} className="w-full py-5 bg-blue-600 text-white font-black rounded-3xl uppercase tracking-widest text-sm active:scale-95 shadow-lg">SAVE PLAN</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;