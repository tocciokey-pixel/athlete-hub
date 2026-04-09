import React, { useState, useRef, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, query, onSnapshot, deleteDoc } from 'firebase/firestore';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { 
  Trophy, Utensils, Scale, Calendar, Plus, ChevronRight, 
  Target, Zap, Clock, Info, AlertCircle, Save, MessageSquare, Brain, Camera, Image as ImageIcon, X, User, Activity, Edit3, Trash2, Send, Loader2
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
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; // Gemini APIキー

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
  const [chatMessages, setChatMessages] = useState([{ role: 'ai', text: '専属のアドバイザーです。食事や体調、試合の準備について何でも相談してください！' }]);

  // 入力フォーム（下書き機能のために一括管理）
  const [inputs, setInputs] = useState({
    weight: { weight: "", date: getTodayJST() },
    meal: { name: "", calories: "", image: null, imageFile: null, date: getTodayJST(), time: getCurrentTimeJST() },
    match: { title: "", date: "", location: "" }
  });

  // UI管理
  const [modalType, setModalType] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatImage, setChatImage] = useState(null);
  const [chatImageFile, setChatImageFile] = useState(null);
  const [isMealSuggestionMode, setIsMealSuggestionMode] = useState(false);
  
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

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
      setMeals(data.sort((a, b) => new Date(`${b.date}T${b.time}`) - new Date(`${a.date}T${a.time}`)));
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

  // --- ヘルパー関数 ---
  const toBase64 = (file) => new Promise((r, j) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => r(reader.result.split(',')[1]);
    reader.onerror = e => j(e);
  });

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
      match: { title: "", date: "", location: "" }
    };
    setInputs(prev => ({ ...prev, [type]: defaultInputs[type] }));
  };

  const sendChatMessage = async () => {
    if (!chatInput && !chatImage) return;
    if (!apiKey) {
      alert('Gemini APIキーが設定されていません（.env ファイルを確認してください）');
      return;
    }
    const userMsg = chatInput;
    const userImage = chatImage;
    const userImageFile = chatImageFile;
    const mealSuggestionMode = isMealSuggestionMode;
    setIsAiProcessing(true);
    const newMsgs = [...chatMessages, {
      role: 'user',
      text: userMsg,
      image: userImage,
      isMealSuggestion: mealSuggestionMode
    }];
    setChatMessages(newMsgs);
    setChatInput("");
    setChatImage(null);
    setChatImageFile(null);
    setIsMealSuggestionMode(false);
    try {
      // 献立相談モードの場合、特別なプロンプトを作成
      let prompt = userMsg;
      let systemPrompt = `あなたはプロの管理栄養士です。常に食事管理の文脈で回答してください。
回答ルール:
- まず結論を1行で述べる
- 次に「推定PFC(たんぱく質/脂質/炭水化物)」と「改善ポイント」を簡潔に示す
- 励ます口調で短く実用的に伝える
ユーザー情報: 年齢${profile.age || '未設定'}、目標体重${profile.targetWeight || '未設定'}kg、競技${profile.lifestyle || '未設定'}、悩み${profile.improvementPoints || '未設定'}`;

      if (mealSuggestionMode) {
        const recentMeals = meals.slice(-10).map(m => `${m.date} ${m.time}: ${m.name}`).join('\n');
        const recentWeights = weightData.slice(-5).map(w => `${w.date}: ${w.weight}kg`).join('\n');
        const upcomingMatches = matches.filter(m => new Date(m.date) >= new Date()).slice(0, 3).map(m => `${m.date}: ${m.title}`).join('\n');

        systemPrompt = `あなたはプロの管理栄養士です。以下の情報を基に、冷蔵庫の中身の写真から最適な献立を提案してください。

【ユーザー情報】
年齢: ${profile.age}
目標体重: ${profile.targetWeight}kg
競技: ${profile.lifestyle}
悩み: ${profile.improvementPoints}

【最近の食事履歴（最新10件）】
${recentMeals}

【体重推移（最新5件）】
${recentWeights}

【今後の試合予定】
${upcomingMatches}

【提案のポイント】
- 栄養バランスの取れた献立を提案
- カロリー目安を考慮
- 競技に適した栄養素を考慮
- 冷蔵庫の中身を最大限活用
- 調理時間も考慮
- 具体的なレシピを提案`;

        prompt = userMsg || "冷蔵庫の中身から今日の献立を提案してください。";
      }

      const historyContents = chatMessages
        .filter(m => m.role === 'user' || m.role === 'ai')
        .slice(-12)
        .map(m => ({
          role: m.role === 'ai' ? 'model' : 'user',
          parts: [{ text: m.text || (m.image ? '画像を送信しました' : '') }]
        }));

      const currentUserParts = [{ text: prompt || '食事についてアドバイスしてください。' }];
      if (userImageFile) {
        const base64 = await toBase64(userImageFile);
        currentUserParts.push({
          inlineData: { mimeType: userImageFile.type, data: base64 }
        });
      }

      const contents = [...historyContents, { role: 'user', parts: currentUserParts }];

      const requestBody = {
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048
        }
      };

      const parseJsonSafely = (raw) => {
        try {
          return raw ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      };

      const listAvailableModels = async (apiVersion) => {
        const response = await fetch(`https://generativelanguage.googleapis.com/${apiVersion}/models?key=${apiKey}`);
        const raw = await response.text();
        const parsed = parseJsonSafely(raw);
        const modelNames = (parsed.models || [])
          .map((m) => (m.name || '').replace(/^models\//, ''))
          .filter(Boolean);
        return { response, modelNames, parsed };
      };

      const callGemini = async (apiVersion, modelName) => {
        const response = await fetch(`https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        const raw = await response.text();
        const parsed = parseJsonSafely(raw);
        return { response, parsed };
      };

      const preferredModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      const apiVersions = ['v1', 'v1beta'];

      let responsePack = null;
      let lastError = null;

      for (const apiVersion of apiVersions) {
        const listPack = await listAvailableModels(apiVersion);
        const listIsUsable = listPack.response.ok && listPack.modelNames.length > 0;
        const modelsToTry = listIsUsable
          ? preferredModels.filter((m) => listPack.modelNames.includes(m))
          : preferredModels;

        for (const model of modelsToTry) {
          responsePack = await callGemini(apiVersion, model);
          if (responsePack.response.ok) {
            break;
          }
          const apiMessage = responsePack.parsed?.error?.message || `HTTP ${responsePack.response.status}`;
          lastError = `${apiVersion}/${model}: ${apiMessage}`;
        }

        if (responsePack?.response?.ok) {
          break;
        }

        if (!listPack.response.ok) {
          const listErr = listPack.parsed?.error?.message || `HTTP ${listPack.response.status}`;
          lastError = `${apiVersion}/models.list: ${listErr}`;
        }
      }

      if (!responsePack?.response?.ok) {
        throw new Error(`Gemini APIエラー: ${lastError || '利用可能なモデルが見つかりません'}`);
      }

      const result = responsePack.parsed;
      if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
        throw new Error('Geminiの応答形式が不正です');
      }

      const aiText = result.candidates[0].content.parts[0].text;
      setChatMessages([...newMsgs, { role: 'ai', text: aiText }]);
    } catch (e) {
      console.error('Chat error:', e);
      const rawMessage = String(e?.message || '');
      const lower = rawMessage.toLowerCase();
      let friendly = `エラーが発生しました。もう一度試してください。\n${rawMessage}`;

      if (lower.includes('reported as leaked') || lower.includes('api key invalid') || lower.includes('api_key_invalid')) {
        friendly = 'APIキーが無効化されています（漏洩判定）。Google AI Studioで新しいキーを再発行し、GitHub Secretsの VITE_GEMINI_API_KEY を更新して再デプロイしてください。';
      } else if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('resource_exhausted')) {
        friendly = 'Gemini APIの利用上限に達しました。時間を空けて再試行するか、請求設定・上限設定を見直してください。';
      } else if (lower.includes('is not found for api version') || lower.includes('not supported for generatecontent')) {
        friendly = '選択したモデルがこのAPIバージョンで利用できません。利用可能モデルを再取得して再試行してください。';
      }

      setChatMessages([...newMsgs, { role: 'ai', text: friendly }]);
    } finally {
      setIsAiProcessing(false);
    }
  };

  // --- 計算 ---
  const currentW = weightData[weightData.length - 1]?.weight || null;
  const nextM = matches.find(m => new Date(m.date) >= new Date().setHours(0,0,0,0)) || null;
  const daysUntil = nextM ? Math.ceil((new Date(nextM.date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
  const todayTotalCals = meals.filter(m => m.date === getTodayJST()).reduce((s, m) => s + (m.calories || 0), 0);

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
                if (!mealsByDate[m.date]) mealsByDate[m.date] = [];
                mealsByDate[m.date].push(m);
              });
              const sortedDates = Object.keys(mealsByDate).sort((a, b) => new Date(b) - new Date(a));
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
                      const dailyTotal = dayMeals.reduce((sum, m) => sum + (parseInt(m.calories) || 0), 0);
                      const dateStr = date.split('-').reverse().join('/');
                      return (
                        <div key={date} className="space-y-3">
                          <div className="px-1 py-3 flex justify-between items-center border-b-2 border-slate-200">
                            <span className="font-black text-slate-700 text-sm uppercase">{dateStr}</span>
                          </div>
                          {dayMeals.sort((a, b) => b.time.localeCompare(a.time)).map(m => (
                            <div key={m.id} className="bg-white p-4 rounded-3xl flex items-center justify-between border border-slate-100 shadow-sm group hover:shadow-md transition-shadow">
                              <div className="flex items-center gap-4">
                                {m.image ? <img src={m.image} className="w-14 h-14 rounded-2xl object-cover" /> : <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center text-green-600"><Utensils className="w-5 h-5" /></div>}
                                <div>
                                  <div className="text-[9px] font-black text-slate-300 uppercase">{m.time}</div>
                                  <p className="text-sm font-black text-slate-700 leading-tight">{m.name || '記録なし'}</p>
                                </div>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button onClick={() => openEditModal('meal', m)} className="p-2 text-slate-300 hover:text-blue-500 active:scale-75 transition-all"><Edit3 className="w-4 h-4" /></button>
                                <button onClick={() => deleteItem('meal', m.id)} className="p-2 text-slate-300 hover:text-red-500 active:scale-75 transition-all"><Trash2 className="w-4 h-4" /></button>
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

            {activeTab === 'chat' && (
              <div className="flex flex-col h-[calc(100vh-210px)] md:h-[630px] animate-in fade-in overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-hide pb-4">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-4 rounded-3xl text-xs font-bold shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-700 rounded-tl-none border border-slate-100'}`}>
                        {msg.image && (
                          <img src={msg.image} className="w-32 h-32 rounded-2xl object-cover mb-3" />
                        )}
                        {msg.isMealSuggestion && (
                          <div className="text-[10px] bg-blue-100 text-blue-700 px-2 py-1 rounded-full inline-block mb-2">献立相談</div>
                        )}
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {isAiProcessing && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] p-4 rounded-3xl text-xs font-bold shadow-sm bg-white text-slate-700 rounded-tl-none border border-slate-100 flex items-center gap-2">
                        <Loader2 className="animate-spin w-4 h-4" />
                        <span>入力中...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="mt-4 space-y-3">
                  {chatImage && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
                      <img src={chatImage} className="w-16 h-16 rounded-xl object-cover" />
                      <div className="flex-1">
                        <p className="text-xs font-black text-slate-600">冷蔵庫写真を添付</p>
                        <button onClick={() => { setChatImage(null); setChatImageFile(null); }} className="text-xs text-red-500 hover:text-red-700">削除</button>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 bg-white p-2 rounded-[24px] border border-slate-100 shadow-lg">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (file) {
                          setChatImage(URL.createObjectURL(file));
                          setChatImageFile(file);
                        }
                      }}
                      className="hidden"
                      id="chat-image-upload"
                    />
                    <label htmlFor="chat-image-upload" className="p-3 text-slate-400 hover:text-blue-500 cursor-pointer">
                      <Camera className="w-4 h-4" />
                    </label>
                    <input
                      type="text"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !isAiProcessing && sendChatMessage()}
                      placeholder="栄養士に相談..."
                      className="flex-1 bg-transparent border-none focus:ring-0 text-base px-3 font-bold"
                      disabled={isAiProcessing}
                    />
                    <button
                      onClick={() => setIsMealSuggestionMode(!isMealSuggestionMode)}
                      className={`p-2 rounded-full ${isMealSuggestionMode ? 'bg-green-500 text-white' : 'text-slate-400 hover:text-green-500'}`}
                      title="献立相談モード"
                    >
                      <Utensils className="w-4 h-4" />
                    </button>
                    <button
                      onClick={sendChatMessage}
                      disabled={isAiProcessing}
                      className="px-3 py-2 bg-blue-600 text-white rounded-full active:scale-95 disabled:opacity-50 flex items-center gap-1.5 min-w-[72px] justify-center"
                      title="送信"
                    >
                      <Send className="w-4 h-4" />
                      <span className="text-xs font-black">送信</span>
                    </button>
                  </div>
                  {isMealSuggestionMode && (
                    <div className="text-center">
                      <p className="text-xs font-black text-green-600 bg-green-50 px-3 py-2 rounded-full inline-block">
                        🍳 献立相談モード：写真は任意です（テキストだけでも相談できます）
                      </p>
                    </div>
                  )}
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
                      <div className="flex-1 min-w-0"><h4 className="font-black text-slate-700 truncate">{m.title}</h4><p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{m.location || 'No location'}</p></div>
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
          <NavButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} icon={<MessageSquare className="w-5 h-5" />} label="CHAT" />
          <NavButton active={activeTab === 'schedule'} onClick={() => setActiveTab('schedule')} icon={<Calendar className="w-5 h-5" />} label="PLAN" />
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
                      <input type="time" value={inputs.meal.time} onChange={e => setInputs({...inputs, meal: {...inputs.meal, time: e.target.value}})} className="p-4 bg-slate-100 rounded-2xl font-black text-xs" />
                    </div>
                    <input type="text" value={inputs.meal.name} onChange={e => setInputs({...inputs, meal: {...inputs.meal, name: e.target.value}})} className="w-full p-4 bg-slate-100 rounded-2xl font-black text-base" placeholder="Menu name" />
                    <button onClick={handleSaveMeal} className="w-full py-5 bg-blue-600 text-white font-black rounded-3xl uppercase tracking-widest text-sm active:scale-95 shadow-lg">SAVE MEAL</button>
                  </>
                )}

                {modalType === 'match' && (
                  <>
                    <input type="date" value={inputs.match.date} onChange={e => setInputs({...inputs, match: {...inputs.match, date: e.target.value}})} className="w-full p-4 bg-slate-100 rounded-2xl font-black text-base" />
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