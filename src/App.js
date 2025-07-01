import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut
} from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    doc, 
    setDoc, 
    getDoc, 
    query, 
    where, 
    onSnapshot,
    deleteDoc,
    getDocs,
    Timestamp
} from 'firebase/firestore';
import { BarChart, ChevronDown, ChevronUp, Download, LogOut, Plus, Settings, Trash2, User, X, AlertTriangle } from 'lucide-react';

// Firebase 설정 변수 (사용자 프로젝트 정보로 직접 설정)
const firebaseConfig = {
  apiKey: "AIzaSyCNrl2SFx6kfIJ-ALLkuAEnRU4WgrYdvP8",
  authDomain: "honn-training-app.firebaseapp.com",
  projectId: "honn-training-app",
  storageBucket: "honn-training-app.firebasestorage.app",
  messagingSenderId: "732924536785",
  appId: "1:732924536785:web:af785bb898b0df1a8d22f0",
  measurementId: "G-8DPL2LNQ0J"
};

// Firebase 앱 초기화
let app;
let auth;
let db;
let firebaseInitialized = false;

// FirebaseConfig가 유효한 경우에만 초기화 시도
if (firebaseConfig && firebaseConfig.apiKey) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        firebaseInitialized = true;
    } catch (e) {
        console.error("Firebase initialization error:", e);
    }
}

// 훈련 카테고리
const TRAINING_CATEGORIES = ["스트레칭", "유산소", "근력", "기술", "기타"];

// --- Helper Functions ---

// CSV 데이터 생성 및 다운로드
const downloadCSV = (data, filename = 'training-log.csv') => {
    if (!data || data.length === 0) {
        console.log("내보낼 데이터가 없습니다.");
        return;
    }
    const headers = ['날짜', '스트레칭(분)', '유산소(분)', '근력(분)', '기술(분)', '기타(분)', '총합(분)'];
    const csvContent = [
        headers.join(','),
        ...data.map(log => [
            log.date,
            log.trainings?.['스트레칭'] || 0,
            log.trainings?.['유산소'] || 0,
            log.trainings?.['근력'] || 0,
            log.trainings?.['기술'] || 0,
            log.trainings?.['기타'] || 0,
            log.totalDuration || 0
        ].join(','))
    ].join('\n');

    const bom = '\uFEFF'; // UTF-8 BOM
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

// 금주의 시작(월요일)과 끝(일요일) 날짜 구하기
const getWeekRange = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diffToMonday));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const formatDate = (dt) => dt.toISOString().split('T')[0];
    return { start: formatDate(monday), end: formatDate(sunday) };
};

// --- Components ---

// 로딩 스피너
const LoadingSpinner = () => (
    <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
    </div>
);

// 커스텀 모달
const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-lg font-bold">{title}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <X size={24} />
                    </button>
                </div>
                <div className="p-4">{children}</div>
            </div>
        </div>
    );
};

// 로그인/회원가입 화면
const AuthScreen = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState('athlete');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleAuthAction = async (e) => {
        e.preventDefault();
        if (!firebaseInitialized) {
            setError("Firebase가 연결되지 않았습니다. 설정을 확인해주세요.");
            return;
        }
        setError('');
        setIsLoading(true);

        if (!email.includes('@') || password.length < 6) {
            setError("유효한 이메일과 6자 이상의 비밀번호를 입력하세요.");
            setIsLoading(false);
            return;
        }
        if (!isLogin && (!name || !phone)) {
            setError("이름과 전화번호를 모두 입력하세요.");
            setIsLoading(false);
            return;
        }

        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                
                await setDoc(doc(db, "users", user.uid), {
                    name,
                    phone,
                    email,
                    role,
                    createdAt: Timestamp.now()
                });
            }
        } catch (err) {
            console.error("Auth error:", err);
            let friendlyMessage = "오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
            if (err.code === 'auth/operation-not-allowed') {
                friendlyMessage = "오류: 이메일 로그인이 활성화되지 않았습니다. Firebase 콘솔 설정을 확인하세요.";
            } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
                friendlyMessage = "이메일 또는 비밀번호가 올바르지 않습니다.";
            } else if (err.code === 'auth/email-already-in-use') {
                friendlyMessage = "이미 가입된 이메일입니다.";
            }
            setError(friendlyMessage);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col justify-center items-center p-4">
            <div className="w-full max-w-md bg-white rounded-lg shadow-md p-8">
                <h1 className="text-3xl font-bold text-center text-blue-600 mb-2">HONN</h1>
                <h2 className="text-xl font-semibold text-center text-gray-700 mb-6">
                    {isLogin ? '훈련 기록 로그인' : '회원가입'}
                </h2>
                <form onSubmit={handleAuthAction}>
                    {!isLogin && (
                        <>
                            <div className="mb-4">
                                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">이름</label>
                                <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="홍길동" required />
                            </div>
                            <div className="mb-4">
                                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="phone">전화번호</label>
                                <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="010-1234-5678" required />
                            </div>
                             <div className="mb-4">
                                <label className="block text-gray-700 text-sm font-bold mb-2">역할</label>
                                <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    <option value="athlete">선수</option>
                                    <option value="coach">코치</option>
                                </select>
                            </div>
                        </>
                    )}
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">이메일</label>
                        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="email@example.com" required />
                    </div>
                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">비밀번호</label>
                        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="6자 이상" required />
                    </div>
                    
                    {error && <p className="text-red-500 text-xs italic mb-4">{error}</p>}
                    
                    <button type="submit" disabled={isLoading || !firebaseInitialized} className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline transition duration-300 disabled:bg-blue-300">
                        {isLoading ? '처리 중...' : (isLogin ? '로그인' : '가입하기')}
                    </button>
                </form>
                <p className="text-center text-sm text-gray-600 mt-6">
                    {isLogin ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}
                    <button onClick={() => { setIsLogin(!isLogin); setError(''); }} className="font-bold text-blue-500 hover:text-blue-700 ml-2">
                        {isLogin ? '회원가입' : '로그인'}
                    </button>
                </p>
            </div>
        </div>
    );
};

// 선수 대시보드
const AthleteDashboard = ({ user, userData }) => {
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const initialDurations = TRAINING_CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat]: '' }), {});
    const [durations, setDurations] = useState(initialDurations);
    const [logs, setLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!user || !user.uid) return;
        setIsLoading(true);
        const q = query(collection(db, "trainingLogs"), where("userId", "==", user.uid));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const logsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            logsData.sort((a, b) => new Date(b.date) - new Date(a.date));
            setLogs(logsData);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching logs:", error);
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [user.uid]);

    const handleDurationChange = (category, value) => {
        setDurations(prev => ({ ...prev, [category]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const trainings = {};
        let totalDuration = 0;
        let hasInput = false;

        for (const category of TRAINING_CATEGORIES) {
            const duration = parseInt(durations[category] || 0, 10);
            if (duration > 0) {
                hasInput = true;
            }
            trainings[category] = duration;
            totalDuration += duration;
        }

        if (!hasInput) {
            setMessage('하나 이상의 훈련 시간을 입력하세요.');
            setTimeout(() => setMessage(''), 3000);
            return;
        }

        const logData = {
            userId: user.uid,
            userName: userData.name,
            date,
            trainings,
            totalDuration,
            createdAt: Timestamp.now()
        };
        
        try {
            // 해당 날짜의 기록을 덮어쓰기 위해 고유 ID 사용
            const logDocRef = doc(db, "trainingLogs", `${user.uid}_${date}`);
            await setDoc(logDocRef, logData);
            setDurations(initialDurations);
            setMessage('훈련 기록이 성공적으로 저장되었습니다.');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error adding document: ", error);
            setMessage('기록 저장 중 오류가 발생했습니다.');
            setTimeout(() => setMessage(''), 3000);
        }
    };

    const { weekLogs, totalWeekDuration } = useMemo(() => {
        const { start, end } = getWeekRange(new Date());
        const filteredLogs = logs.filter(log => log.date >= start && log.date <= end);
        const totalDuration = filteredLogs.reduce((sum, log) => sum + (log.totalDuration || 0), 0);
        return { weekLogs: filteredLogs, totalWeekDuration: totalDuration };
    }, [logs]);

    const weekDays = useMemo(() => {
        const { start } = getWeekRange(new Date());
        const days = [];
        const startDate = new Date(start);
        for (let i = 0; i < 7; i++) {
            const day = new Date(startDate);
            day.setDate(startDate.getDate() + i);
            days.push({
                date: day.toISOString().split('T')[0],
                dayName: ['일', '월', '화', '수', '목', '금', '토'][day.getDay()]
            });
        }
        return days;
    }, []);

    if (isLoading) {
      return (
        <div className="p-4 md:p-6 bg-gray-50 min-h-full flex justify-center items-center">
          <LoadingSpinner />
        </div>
      );
    }

    return (
        <div className="p-4 md:p-6 bg-gray-50 min-h-full">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">훈련 기록</h2>
            <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">날짜</label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full md:w-1/3 p-2 border rounded-md" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                        {TRAINING_CATEGORIES.map(cat => (
                            <div key={cat}>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{cat}</label>
                                <input 
                                    type="number" 
                                    value={durations[cat]} 
                                    onChange={e => handleDurationChange(cat, e.target.value)} 
                                    placeholder="분" 
                                    className="w-full p-2 border rounded-md" 
                                />
                            </div>
                        ))}
                    </div>
                    <button type="submit" className="w-full md:w-auto bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition flex items-center justify-center">
                        <Plus size={18} className="mr-2" /> 기록 저장
                    </button>
                    {message && <p className="text-green-600 mt-2 text-sm">{message}</p>}
                </form>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-800">이번 주 훈련 요약</h3>
                    <button onClick={() => downloadCSV(logs, `${userData.name}_훈련기록.csv`)} className="bg-green-500 text-white px-3 py-1 rounded-md hover:bg-green-600 text-sm flex items-center">
                        <Download size={16} className="mr-1" /> 전체 기록 내보내기
                    </button>
                </div>
                <div className="flex items-center text-blue-600">
                    <BarChart size={24} className="mr-2" />
                    <p className="text-xl">총 훈련 시간: <span className="font-bold">{Math.floor(totalWeekDuration / 60)}시간 {totalWeekDuration % 60}분</span></p>
                </div>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>{weekDays.map(day => <th key={day.date} className="border-b-2 p-2 text-sm font-semibold text-gray-600">{day.dayName} ({day.date.slice(5)})</th>)}</tr>
                        </thead>
                        <tbody>
                            <tr>
                                {weekDays.map(day => {
                                    const logForDay = weekLogs.find(log => log.date === day.date);
                                    return (
                                        <td key={day.date} className="border-b p-2 align-top">
                                            {logForDay && logForDay.trainings ? (
                                                Object.entries(logForDay.trainings).map(([cat, dur]) => dur > 0 && (
                                                    <div key={cat} className="text-xs bg-blue-100 text-blue-800 p-1 rounded mb-1">
                                                        {cat}: {dur}분
                                                    </div>
                                                ))
                                            ) : <div className="text-xs text-gray-400">-</div>}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// 코치 대시보드
const CoachDashboard = ({ userData }) => {
    const [athletes, setAthletes] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    
    const [expandedAthleteId, setExpandedAthleteId] = useState(null);
    const [viewedLogs, setViewedLogs] = useState([]);
    const [isViewingLogs, setIsViewingLogs] = useState(false);


    useEffect(() => {
        setIsLoading(true);
        const q = query(collection(db, "users"), where("role", "==", "athlete"));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            setAthletes(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching athletes:", error);
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const handleToggleView = async (athleteId) => {
        if (expandedAthleteId === athleteId) {
            setExpandedAthleteId(null);
            setViewedLogs([]);
        } else {
            setIsViewingLogs(true);
            setExpandedAthleteId(athleteId);
            const { start, end } = getWeekRange(new Date());
            // Firestore 인덱스 오류를 피하기 위해, 먼저 userId로만 모든 기록을 가져옵니다.
            const q = query(collection(db, "trainingLogs"), 
                where("userId", "==", athleteId)
            );
            const querySnapshot = await getDocs(q);
            const allLogs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // 그 다음 클라이언트 측에서 날짜로 필터링합니다.
            const logsData = allLogs.filter(log => log.date >= start && log.date <= end);
            
            logsData.sort((a, b) => new Date(a.date) - new Date(b.date));
            setViewedLogs(logsData);
            setIsViewingLogs(false);
        }
    };

    const handleExportLogs = useCallback(async (athlete) => {
        const q = query(collection(db, "trainingLogs"), where("userId", "==", athlete.id));
        const querySnapshot = await getDocs(q);
        const logsData = querySnapshot.docs.map(doc => doc.data());
        logsData.sort((a, b) => new Date(a.date) - new Date(b.date));
        downloadCSV(logsData, `${athlete.name}_훈련기록.csv`);
    }, []);

    if (isLoading) return <LoadingSpinner />;

    return (
        <div className="p-4 md:p-6 bg-gray-50 min-h-full">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">선수 관리</h2>
                {userData.role === 'admin' && (
                    <button onClick={() => setIsSettingsOpen(true)} className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition flex items-center">
                        <Settings size={18} className="mr-2" /> 설정
                    </button>
                )}
            </div>
            <div className="bg-white rounded-lg shadow-md">
                <ul className="divide-y divide-gray-200">
                    {athletes.map(athlete => (
                        <li key={athlete.id} className="p-4 flex flex-col">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center">
                                    <div className="bg-blue-100 text-blue-600 rounded-full p-2 mr-4"><User size={20} /></div>
                                    <div>
                                        <p className="font-semibold text-gray-800">{athlete.name}</p>
                                        <p className="text-sm text-gray-500">{athlete.phone}</p>
                                    </div>
                                </div>
                                <div className="flex space-x-2">
                                    <button onClick={() => handleToggleView(athlete.id)} className="bg-blue-500 text-white px-3 py-1 rounded-md text-sm hover:bg-blue-600 flex items-center">
                                        {expandedAthleteId === athlete.id ? <ChevronUp size={16} className="mr-1"/> : <ChevronDown size={16} className="mr-1"/>}
                                        보기
                                    </button>
                                    <button onClick={() => handleExportLogs(athlete)} className="bg-green-500 text-white px-3 py-1 rounded-md text-sm hover:bg-green-600">내보내기</button>
                                </div>
                            </div>
                            {expandedAthleteId === athlete.id && (
                                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                                    {isViewingLogs ? <LoadingSpinner /> : (
                                        viewedLogs.length > 0 ? (
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="text-left">
                                                        <th className="p-2 border-b">날짜</th>
                                                        {TRAINING_CATEGORIES.map(cat => <th key={cat} className="p-2 border-b">{cat}</th>)}
                                                        <th className="p-2 border-b">총합</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {viewedLogs.map(log => (
                                                        <tr key={log.id}>
                                                            <td className="p-2 border-b">{log.date}</td>
                                                            {TRAINING_CATEGORIES.map(cat => <td key={cat} className="p-2 border-b">{(log.trainings && log.trainings[cat]) || 0}분</td>)}
                                                            <td className="p-2 border-b font-bold">{log.totalDuration || 0}분</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : <p className="text-sm text-gray-500">이번 주 훈련 기록이 없습니다.</p>
                                    )}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
            <AdminPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        </div>
    );
};

// 관리자 패널
const AdminPanel = ({ isOpen, onClose }) => {
    const [users, setUsers] = useState([]);
    const [expandedRole, setExpandedRole] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, user: null });

    useEffect(() => {
        if (!isOpen) return;
        const q = query(collection(db, "users"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsubscribe();
    }, [isOpen]);

    const handleDeleteClick = (user) => {
        setConfirmModal({ isOpen: true, user: user });
    };

    const confirmDeleteUser = async () => {
        const { user } = confirmModal;
        if (!user) return;

        try {
            await deleteDoc(doc(db, "users", user.id));
            const logsQuery = query(collection(db, "trainingLogs"), where("userId", "==", user.id));
            const logsSnapshot = await getDocs(logsQuery);
            await Promise.all(logsSnapshot.docs.map(logDoc => deleteDoc(logDoc.ref)));
        } catch (error) {
            console.error("Error deleting user:", error);
        } finally {
            setConfirmModal({ isOpen: false, user: null });
        }
    };
    
    const renderUserList = (role) => {
        const filteredUsers = users.filter(u => u.role === role);
        const roleName = role === 'coach' ? '코치' : role === 'admin' ? '관리자' : '선수';
        return (
            <div className="mb-4">
                <button onClick={() => setExpandedRole(expandedRole === role ? null : role)} className="w-full text-left font-bold text-lg p-2 bg-gray-200 rounded-md flex justify-between items-center">
                    {roleName} 목록 ({filteredUsers.length})
                    {expandedRole === role ? <ChevronUp /> : <ChevronDown />}
                </button>
                {expandedRole === role && (
                     <ul className="divide-y mt-2">
                        {filteredUsers.map(user => (
                            <li key={user.id} className="flex justify-between items-center py-2">
                                <div>
                                    <p>{user.name} ({user.email})</p>
                                    <p className="text-sm text-gray-500">{user.phone}</p>
                                </div>
                                <button onClick={() => handleDeleteClick(user)} className="text-red-500 hover:text-red-700">
                                    <Trash2 size={20} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    };

    return (
        <>
            <Modal isOpen={isOpen} onClose={onClose} title="회원 관리 (관리자)">
                {users.length === 0 ? <LoadingSpinner /> : (
                    <div>
                        <p className="text-sm text-yellow-700 bg-yellow-100 p-2 rounded-md mb-4">
                            주의: 회원 삭제 시 관련 데이터가 모두 삭제되며 복구할 수 없습니다. Firebase 인증 계정은 보안상 직접 삭제되지 않습니다.
                        </p>
                        {renderUserList('admin')}
                        {renderUserList('coach')}
                        {renderUserList('athlete')}
                    </div>
                )}
            </Modal>
            <Modal isOpen={confirmModal.isOpen} onClose={() => setConfirmModal({ isOpen: false, user: null })} title="회원 삭제 확인">
                <div>
                    <p className="mb-4">정말로 <span className="font-bold">{confirmModal.user?.name}</span> 회원을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</p>
                    <div className="flex justify-end space-x-2">
                        <button onClick={() => setConfirmModal({ isOpen: false, user: null })} className="px-4 py-2 bg-gray-300 rounded-md hover:bg-gray-400">취소</button>
                        <button onClick={confirmDeleteUser} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">삭제</button>
                    </div>
                </div>
            </Modal>
        </>
    );
};

// 메인 앱 컴포넌트
export default function App() {
    const [user, setUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!firebaseInitialized) {
            console.error("Firebase is not initialized. Please check your project connection and config.");
            setIsLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser && !currentUser.isAnonymous) {
                const userDocRef = doc(db, "users", currentUser.uid);
                const userDocSnap = await getDoc(userDocRef);
                if (userDocSnap.exists()) {
                    setUser(currentUser);
                    setUserData({ id: userDocSnap.id, ...userDocSnap.data() });
                } else {
                    await signOut(auth);
                }
            } else {
                setUser(null);
                setUserData(null);
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleLogout = async () => {
        await signOut(auth);
    };

    if (!firebaseInitialized) {
        return (
            <div className="w-screen h-screen flex flex-col justify-center items-center text-center p-4">
                <AlertTriangle size={48} className="text-red-500 mb-4" />
                <h1 className="text-xl font-bold">Firebase 연결 오류</h1>
                <p className="text-gray-600 mt-2">Firebase 설정이 올바르지 않습니다. 앱 설정을 확인해주세요.</p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="w-screen h-screen flex justify-center items-center">
                <LoadingSpinner />
            </div>
        );
    }

    return (
        <div className="w-full min-h-screen bg-gray-100 font-sans">
            {user && userData ? (
                <main>
                    <header className="bg-white shadow-md">
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                            <div className="flex justify-between items-center h-16">
                                <div className="flex items-center">
                                    <h1 className="text-xl font-bold text-blue-600">HONN</h1>
                                    <span className="ml-4 pl-4 border-l border-gray-300 text-gray-600 font-semibold">{userData.name}님 ({userData.role})</span>
                                </div>
                                <button onClick={handleLogout} className="flex items-center text-gray-500 hover:text-red-600 transition">
                                    <LogOut size={18} className="mr-1" />
                                    로그아웃
                                </button>
                            </div>
                        </div>
                    </header>
                    {userData.role === 'athlete' ? (
                        <AthleteDashboard user={user} userData={userData} />
                    ) : (
                        <CoachDashboard userData={userData} />
                    )}
                </main>
            ) : (
                <AuthScreen />
            )}
        </div>
    );
}
