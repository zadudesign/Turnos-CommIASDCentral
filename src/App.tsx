import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Calendar, 
  Settings, 
  Plus, 
  Trash2, 
  Search, 
  ChevronRight, 
  Lock, 
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  UserCircle,
  Trophy,
  Star,
  Clock,
  Layout,
  ChevronLeft,
  Filter
} from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, parseISO, subWeeks, isWithinInterval, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from './lib/utils';
import { 
  Volunteer, 
  ServiceType, 
  RoleFunction, 
  ALL_FUNCTIONS, 
  ALL_SERVICES, 
  ADMIN_PIN,
  ScheduleAssignment,
  COLORS
} from './types';

/**
 * 📝 NOTA PARA CONEXIÓN CON FIREBASE (Frontend - Client SDK)
 * 
 * Si prefieres conectar directamente desde el frontend:
 * 
 * 1. Instala el SDK: npm install firebase
 * 2. Crea un archivo src/lib/firebase.ts:
 * 
 * import { initializeApp } from "firebase/app";
 * import { getFirestore } from "firebase/firestore";
 * 
 * const firebaseConfig = {
 *   apiKey: "TU_API_KEY",
 *   authDomain: "TU_PROJECT.firebaseapp.com",
 *   projectId: "TU_PROJECT",
 *   storageBucket: "TU_PROJECT.appspot.com",
 *   messagingSenderId: "...",
 *   appId: "..."
 * };
 * 
 * const app = initializeApp(firebaseConfig);
 * export const db = getFirestore(app);
 * 
 * 3. En este archivo (App.tsx), reemplaza los 'fetch' por llamadas a Firestore:
 *    import { collection, getDocs } from "firebase/firestore";
 *    const querySnapshot = await getDocs(collection(db, "volunteers"));
 */

export default function App() {
  const [view, setView] = useState<'home' | 'admin' | 'volunteer' | 'top10'>('home');
  const [pin, setPin] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [schedules, setSchedules] = useState<ScheduleAssignment[]>([]);
  const [searchName, setSearchName] = useState('');
  const [selectedVolunteerId, setSelectedVolunteerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  
  // Scoring State
  const [scoringVolunteer, setScoringVolunteer] = useState<Volunteer | null>(null);
  const [scoreForm, setScoreForm] = useState({ puntualidad: 5, responsabilidad: 5, orden: 5 });

  // Registration State
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [newVolunteer, setNewVolunteer] = useState<Partial<Volunteer>>({
    name: '',
    functions: [],
    availability: [],
    restrictions: []
  });

  const currentWeekStart = useMemo(() => format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'), []);
  const lastWeekStart = useMemo(() => format(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd'), []);

  useEffect(() => {
    fetchVolunteers();
    fetchSchedules(currentWeekStart);
  }, [currentWeekStart]);

  const fetchVolunteers = async () => {
    const res = await fetch('/api/volunteers');
    const data = await res.json();
    setVolunteers(data);
  };

  const fetchSchedules = async (week: string) => {
    const res = await fetch(`/api/schedules/${week}`);
    const data = await res.json();
    setSchedules(data);
  };

  const handleAdminLogin = () => {
    if (pin === ADMIN_PIN) {
      setIsAdminAuthenticated(true);
      setView('admin');
    } else {
      alert('PIN Incorrecto');
    }
  };

  const submitScore = async () => {
    if (!scoringVolunteer) return;
    await fetch(`/api/volunteers/${scoringVolunteer.id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...scoreForm, date: new Date().toISOString(), week_start: currentWeekStart })
    });
    setScoringVolunteer(null);
    fetchVolunteers();
  };

  const resetScores = async () => {
    if (confirm('¿Estás seguro de reiniciar todos los puntajes? Esta acción no se puede deshacer.')) {
      await fetch('/api/volunteers/reset-scores', { method: 'POST' });
      fetchVolunteers();
    }
  };

  const registerVolunteer = async () => {
    if (!newVolunteer.name || newVolunteer.functions?.length === 0 || newVolunteer.availability?.length === 0) {
      alert('Por favor completa los campos obligatorios');
      return;
    }
    setLoading(true);
    await fetch('/api/volunteers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newVolunteer)
    });
    setNewVolunteer({ name: '', functions: [], availability: [], restrictions: [] });
    setIsRegisterModalOpen(false);
    await fetchVolunteers();
    setLoading(false);
  };

  const deleteVolunteer = async (id: number) => {
    if (confirm('¿Estás seguro de eliminar este voluntario?')) {
      await fetch(`/api/volunteers/${id}`, { method: 'DELETE' });
      await fetchVolunteers();
    }
  };

  /**
   * Lógica de Asignación Matemática:
   * 1. Prioriza función preferida.
   * 2. Evita >1 servicio/semana (excepto Coordinación).
   * 3. Evita repeticiones consecutivas (semana anterior).
   * 4. Equilibra carga de trabajo usando el historial.
   */
  const generateSchedule = async () => {
    setLoading(true);
    setWarnings([]);
    const assignments: ScheduleAssignment[] = [];
    const usedThisWeek = new Map<number, Set<RoleFunction>>();
    
    // Fetch last week to avoid consecutive repeats
    const lastWeekRes = await fetch(`/api/schedules/${lastWeekStart}`);
    const lastWeekData: ScheduleAssignment[] = await lastWeekRes.json();
    const lastWeekVolunteers = new Set(lastWeekData.map(s => s.volunteer_id));

    for (const service of ALL_SERVICES) {
      const neededFunctions = service === "Domingo" ? ["Transmisión"] : ALL_FUNCTIONS;
      
      for (const func of neededFunctions) {
        const role = func as RoleFunction;
        
        // Filter candidates
        let candidates = volunteers.filter(v => {
          // 1. Availability
          if (!v.availability.includes(service)) return false;
          // 2. Preference
          if (!v.functions.includes(role)) return false;
          // 3. Consecutive check
          if (lastWeekVolunteers.has(v.id)) return false;
          
          // 4. Weekly limit check
          const rolesUsed = usedThisWeek.get(v.id) || new Set();
          if (rolesUsed.size > 0) {
            // Only allow if one of them is Coordination
            const isCoord = role === "Coordinación" || Array.from(rolesUsed).includes("Coordinación");
            if (!isCoord) return false;
          }
          
          return true;
        });

        // If no preferred candidates, relax preference but keep availability and weekly limit
        if (candidates.length === 0) {
          candidates = volunteers.filter(v => {
            if (!v.availability.includes(service)) return false;
            const rolesUsed = usedThisWeek.get(v.id) || new Set();
            if (rolesUsed.size > 0) {
              const isCoord = role === "Coordinación" || Array.from(rolesUsed).includes("Coordinación");
              if (!isCoord) return false;
            }
            return true;
          });
          if (candidates.length > 0) {
            setWarnings(prev => [...prev, `Aviso: Se asignó a alguien no preferente para ${role} en ${service}`]);
          }
        }

        if (candidates.length > 0) {
          // Sort by total score or service count for balance (here we use total_score as a proxy for "reliability")
          // but usually we want "least served" for balance. 
          // For this demo, we'll pick the one with the lowest total_score to give them more chances, 
          // or just random among valid candidates.
          const selected = candidates[Math.floor(Math.random() * candidates.length)];
          
          assignments.push({
            week_start: currentWeekStart,
            service_type: service,
            function_name: role,
            volunteer_id: selected.id
          });

          const currentRoles = usedThisWeek.get(selected.id) || new Set();
          currentRoles.add(role);
          usedThisWeek.set(selected.id, currentRoles);
        } else {
          assignments.push({
            week_start: currentWeekStart,
            service_type: service,
            function_name: role,
            volunteer_id: null
          });
          setWarnings(prev => [...prev, `Error: No hay voluntarios disponibles para ${role} en ${service}`]);
        }
      }
    }

    await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_start: currentWeekStart, assignments })
    });
    await fetchSchedules(currentWeekStart);
    setLoading(false);
  };

  const top10Volunteers = useMemo(() => {
    return [...volunteers].sort((a, b) => b.total_score - a.total_score).slice(0, 10);
  }, [volunteers]);

  const getFunctionIcon = (func: RoleFunction) => {
    switch(func) {
      case "Consola": return <Settings size={14} />;
      case "Transmisión": return <RefreshCw size={14} />;
      case "Proyección": return <Layout size={14} />;
      case "Medios Digitales": return <Star size={14} />;
      case "Coordinación": return <Users size={14} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#d6d6d6] text-[#0f1e3f] font-sans selection:bg-[#ce7e27]/20">
      {/* Header */}
      <header className="bg-[#2e4f76] text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('home')}>
            <div className="w-10 h-10 bg-[#ce7e27] rounded-xl flex items-center justify-center shadow-inner">
              <Calendar size={22} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">Comunicaciones</h1>
              <p className="text-[10px] uppercase tracking-widest opacity-70">Gestión de Turnos</p>
            </div>
          </div>
          
          <nav className="flex items-center gap-6">
            <button 
              onClick={() => setView('top10')}
              className="flex items-center gap-2 text-sm font-medium hover:text-[#ce7e27] transition-colors"
            >
              <Trophy size={18} />
              <span className="hidden sm:inline">Top 10</span>
            </button>
            {view !== 'home' && (
              <button 
                onClick={() => setView('home')}
                className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-sm transition-all"
              >
                Inicio
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mt-12"
            >
              <div 
                onClick={() => setView('volunteer')}
                className="group bg-white p-10 rounded-[2rem] shadow-xl hover:shadow-2xl transition-all cursor-pointer flex flex-col items-center text-center gap-6 border-b-8 border-[#ce7e27]"
              >
                <div className="w-20 h-20 bg-[#d6d6d6] rounded-3xl flex items-center justify-center text-[#2e4f76] group-hover:bg-[#2e4f76] group-hover:text-white transition-all duration-500">
                  <UserCircle size={40} />
                </div>
                <div>
                  <h2 className="text-2xl font-black mb-2 uppercase tracking-tight">Soy Voluntario</h2>
                  <p className="text-gray-500 text-sm leading-relaxed">Consulta tus turnos, revisa tu puntaje acumulado y mantente al día con el equipo.</p>
                </div>
                <div className="bg-[#2e4f76] text-white p-3 rounded-full group-hover:translate-x-2 transition-transform">
                  <ChevronRight size={24} />
                </div>
              </div>

              <div 
                className="group bg-[#0f1e3f] p-10 rounded-[2rem] shadow-xl flex flex-col items-center text-center gap-6 border-b-8 border-[#2e4f76]"
              >
                <div className="w-20 h-20 bg-white/10 rounded-3xl flex items-center justify-center text-[#ce7e27]">
                  <Lock size={40} />
                </div>
                <div className="w-full">
                  <h2 className="text-2xl font-black mb-2 uppercase tracking-tight text-white">Administración</h2>
                  <div className="space-y-3 mt-6">
                    <input 
                      type="password" 
                      placeholder="PIN DE ACCESO"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#ce7e27] transition-all text-center text-white placeholder:text-white/30"
                    />
                    <button 
                      onClick={handleAdminLogin}
                      className="w-full bg-[#ce7e27] text-white py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-[#b36d22] transition-colors shadow-lg"
                    >
                      Entrar al Panel
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'top10' && (
            <motion.div 
              key="top10"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl mx-auto"
            >
              <div className="text-center mb-10">
                <Trophy size={60} className="mx-auto text-[#ce7e27] mb-4" />
                <h2 className="text-4xl font-black uppercase tracking-tighter text-[#0f1e3f]">Top 10 Voluntarios</h2>
                <p className="text-gray-500">Reconocimiento a la excelencia y compromiso</p>
              </div>

              <div className="bg-white rounded-[2rem] shadow-xl overflow-hidden border border-black/5">
                {top10Volunteers.map((v, idx) => (
                  <div key={v.id} className={cn(
                    "flex items-center justify-between p-6 border-b border-gray-100 last:border-0 transition-colors",
                    idx === 0 ? "bg-yellow-50/50" : ""
                  )}>
                    <div className="flex items-center gap-4">
                      <span className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center font-black text-sm",
                        idx === 0 ? "bg-yellow-400 text-yellow-900" : 
                        idx === 1 ? "bg-gray-300 text-gray-700" :
                        idx === 2 ? "bg-orange-300 text-orange-900" : "bg-gray-100 text-gray-400"
                      )}>
                        {idx + 1}
                      </span>
                      <div>
                        <p className="font-bold text-lg">{v.name}</p>
                        <div className="flex gap-1">
                          {v.functions.map(f => (
                            <span key={f} className="text-[8px] bg-gray-100 px-1.5 py-0.5 rounded uppercase font-bold text-gray-500">{f}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-[#2e4f76]">{v.total_score}</p>
                      <p className="text-[10px] uppercase font-bold text-gray-400">Puntos</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'volunteer' && (
            <motion.div 
              key="volunteer"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="max-w-4xl mx-auto"
            >
              <div className="mb-10 text-center">
                <h2 className="text-4xl font-black uppercase tracking-tighter text-[#0f1e3f]">Mi Calendario</h2>
                <p className="text-gray-500">Selecciona tu nombre para ver tus asignaciones</p>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                <div className="md:col-span-1 space-y-4">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      placeholder="Buscar..."
                      value={searchName}
                      onChange={(e) => setSearchName(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-white border border-black/5 rounded-2xl shadow-sm focus:ring-2 focus:ring-[#ce7e27] outline-none"
                    />
                  </div>
                  <div className="bg-white rounded-3xl shadow-sm border border-black/5 max-h-[500px] overflow-y-auto p-2">
                    {volunteers.filter(v => v.name.toLowerCase().includes(searchName.toLowerCase())).map(v => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVolunteerId(v.id)}
                        className={cn(
                          "w-full text-left p-4 rounded-2xl transition-all flex items-center justify-between group",
                          selectedVolunteerId === v.id ? "bg-[#2e4f76] text-white" : "hover:bg-gray-50"
                        )}
                      >
                        <span className="font-bold">{v.name}</span>
                        <ChevronRight size={16} className={cn(selectedVolunteerId === v.id ? "text-white" : "text-gray-300")} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2">
                  {selectedVolunteerId ? (
                    <div className="space-y-6">
                      <div className="bg-[#0f1e3f] text-white p-8 rounded-[2rem] shadow-xl relative overflow-hidden">
                        <div className="relative z-10">
                          <p className="text-[#ce7e27] font-black uppercase tracking-widest text-xs mb-2">Perfil de Voluntario</p>
                          <h3 className="text-3xl font-black mb-4">{volunteers.find(v => v.id === selectedVolunteerId)?.name}</h3>
                          <div className="flex items-center gap-6">
                            <div className="bg-white/10 p-4 rounded-2xl backdrop-blur-md">
                              <p className="text-[10px] uppercase font-bold opacity-50 mb-1">Puntaje Total</p>
                              <p className="text-3xl font-black text-[#ce7e27]">{volunteers.find(v => v.id === selectedVolunteerId)?.total_score}</p>
                            </div>
                            <div className="bg-white/10 p-4 rounded-2xl backdrop-blur-md">
                              <p className="text-[10px] uppercase font-bold opacity-50 mb-1">Turnos esta semana</p>
                              <p className="text-3xl font-black">{schedules.filter(s => s.volunteer_id === selectedVolunteerId).length}</p>
                            </div>
                          </div>
                        </div>
                        <UserCircle size={120} className="absolute -right-4 -bottom-4 text-white/5" />
                      </div>

                      <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-black/5">
                        <h4 className="text-xl font-black uppercase mb-6 flex items-center gap-2">
                          <Calendar className="text-[#ce7e27]" />
                          Mis Turnos - Semana Actual
                        </h4>
                        <div className="space-y-4">
                          {schedules.filter(s => s.volunteer_id === selectedVolunteerId).length > 0 ? (
                            schedules.filter(s => s.volunteer_id === selectedVolunteerId).map((s, idx) => (
                              <div key={idx} className="flex items-center justify-between p-5 bg-[#d6d6d6]/30 rounded-2xl border-l-8 border-[#2e4f76]">
                                <div>
                                  <p className="text-xs font-black text-[#2e4f76] uppercase tracking-widest">{s.service_type}</p>
                                  <p className="text-xl font-bold">{s.function_name}</p>
                                </div>
                                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-[#ce7e27] shadow-sm">
                                  {getFunctionIcon(s.function_name)}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-10 text-gray-400 italic">
                              No tienes turnos asignados para esta semana.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-white/50 rounded-[2rem] border-4 border-dashed border-gray-300 p-12 text-center">
                      <Search size={48} className="mb-4 opacity-20" />
                      <p className="text-lg font-bold">Selecciona tu nombre para ver tu información personalizada</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'admin' && isAdminAuthenticated && (
            <motion.div 
              key="admin"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-[#0f1e3f] p-8 rounded-[2rem] text-white shadow-2xl">
                <div>
                  <h2 className="text-3xl font-black uppercase tracking-tighter">Panel Administrativo</h2>
                  <p className="text-white/60 font-medium">Gestión de voluntarios, programación y evaluación de desempeño</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button 
                    onClick={generateSchedule}
                    disabled={loading}
                    className="flex items-center gap-2 bg-[#ce7e27] text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-[#b36d22] transition-all disabled:opacity-50 shadow-xl shadow-[#ce7e27]/20"
                  >
                    {loading ? <RefreshCw className="animate-spin" size={20} /> : <RefreshCw size={20} />}
                    Generar Turnos
                  </button>
                  <button 
                    onClick={resetScores}
                    className="bg-white/10 hover:bg-red-500/20 hover:text-red-400 px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border border-white/10"
                  >
                    Reiniciar Puntos
                  </button>
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="bg-orange-50 border-l-8 border-orange-400 p-6 rounded-2xl shadow-sm">
                  <h4 className="text-orange-800 font-black uppercase text-xs mb-3 flex items-center gap-2">
                    <AlertCircle size={16} />
                    Alertas de Programación
                  </h4>
                  <ul className="space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i} className="text-orange-700 text-sm font-medium">• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid xl:grid-cols-12 gap-8">
                {/* Left Column: Volunteers & Stats */}
                <div className="xl:col-span-4 space-y-8">
                  {/* Stats Summary */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
                      <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Total Equipo</p>
                      <p className="text-3xl font-black text-[#2e4f76]">{volunteers.length}</p>
                    </div>
                    <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
                      <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Asignados</p>
                      <p className="text-3xl font-black text-[#ce7e27]">{new Set(schedules.map(s => s.volunteer_id)).size}</p>
                    </div>
                  </div>

                  {/* Volunteer List with Scoring Action */}
                  <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-black/5">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                        <Users className="text-[#2e4f76]" />
                        Equipo
                      </h3>
                      <button 
                        onClick={() => setIsRegisterModalOpen(true)}
                        className="p-2 bg-gray-100 rounded-lg hover:bg-[#ce7e27] hover:text-white transition-all shadow-sm"
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                      {volunteers.map(v => (
                        <div key={v.id} className="group flex items-center justify-between p-4 bg-[#d6d6d6]/20 rounded-2xl hover:bg-[#2e4f76]/5 transition-all border border-transparent hover:border-[#2e4f76]/10">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-black text-[#2e4f76] shadow-sm">
                              {v.name[0]}
                            </div>
                            <div>
                              <p className="font-bold text-sm">{v.name}</p>
                              <p className="text-[10px] font-black text-[#ce7e27] uppercase">{v.total_score} Puntos</p>
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => setScoringVolunteer(v)}
                              className="p-2 text-[#2e4f76] hover:bg-[#2e4f76] hover:text-white rounded-lg transition-all"
                              title="Evaluar"
                            >
                              <Star size={16} />
                            </button>
                            <button 
                              onClick={() => deleteVolunteer(v.id)}
                              className="p-2 text-gray-400 hover:text-red-500 rounded-lg transition-all"
                              title="Eliminar"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Column: Calendar Table */}
                <div className="xl:col-span-8">
                  <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-black/5 overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
                        <Calendar className="text-[#ce7e27]" />
                        Calendario Semanal
                      </h3>
                      <div className="flex gap-2">
                        <button className="p-2 bg-gray-100 rounded-xl hover:bg-gray-200"><ChevronLeft size={20} /></button>
                        <button className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-black uppercase tracking-widest">Hoy</button>
                        <button className="p-2 bg-gray-100 rounded-xl hover:bg-gray-200"><ChevronRight size={20} /></button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className="p-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">Función</th>
                            {ALL_SERVICES.map(s => (
                              <th key={s} className="p-4 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 bg-gray-50/50">
                                {s}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ALL_FUNCTIONS.map(func => (
                            <tr key={func} className="hover:bg-gray-50/50 transition-colors">
                              <td className="p-4 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 bg-[#2e4f76]/10 text-[#2e4f76] rounded-lg flex items-center justify-center">
                                    {getFunctionIcon(func)}
                                  </div>
                                  <span className="font-bold text-sm">{func}</span>
                                </div>
                              </td>
                              {ALL_SERVICES.map(service => {
                                const isSunday = service === "Domingo";
                                const isNeeded = !isSunday || func === "Transmisión";
                                const assignment = schedules.find(s => s.service_type === service && s.function_name === func);
                                
                                return (
                                  <td key={service} className={cn(
                                    "p-4 border-b border-gray-100 text-center",
                                    !isNeeded ? "bg-gray-100/30" : ""
                                  )}>
                                    {isNeeded ? (
                                      <div className={cn(
                                        "px-3 py-2 rounded-xl text-xs font-bold transition-all",
                                        assignment?.volunteer_id 
                                          ? "bg-[#2e4f76] text-white shadow-md" 
                                          : "bg-red-50 text-red-400 border border-red-100 italic"
                                      )}>
                                        {assignment?.volunteer_id ? volunteers.find(v => v.id === assignment.volunteer_id)?.name : "Vacante"}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-gray-300 font-black uppercase tracking-tighter">N/A</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Scoring Modal */}
      <AnimatePresence>
        {scoringVolunteer && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0f1e3f]/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-10 overflow-hidden relative"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-[#ce7e27]" />
              <h3 className="text-2xl font-black uppercase tracking-tight mb-2">Evaluar Desempeño</h3>
              <p className="text-gray-500 mb-8 font-medium">Voluntario: <span className="text-[#2e4f76] font-black">{scoringVolunteer.name}</span></p>
              
              <div className="space-y-8">
                {[
                  { key: 'puntualidad', label: 'Puntualidad', icon: <Clock size={18} /> },
                  { key: 'responsabilidad', label: 'Responsabilidad', icon: <CheckCircle2 size={18} /> },
                  { key: 'orden', label: 'Orden', icon: <Layout size={18} /> }
                ].map(field => (
                  <div key={field.key}>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                        {field.icon}
                        {field.label}
                      </label>
                      <span className="text-xl font-black text-[#2e4f76]">{scoreForm[field.key as keyof typeof scoreForm]} pts</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="10" 
                      value={scoreForm[field.key as keyof typeof scoreForm]}
                      onChange={(e) => setScoreForm({...scoreForm, [field.key]: parseInt(e.target.value)})}
                      className="w-full accent-[#ce7e27]"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-4 mt-12">
                <button 
                  onClick={() => setScoringVolunteer(null)}
                  className="flex-1 py-4 rounded-2xl font-black uppercase tracking-widest text-gray-400 hover:bg-gray-100 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={submitScore}
                  className="flex-1 bg-[#2e4f76] text-white py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-[#0f1e3f] transition-all shadow-xl shadow-[#2e4f76]/20"
                >
                  Guardar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Registration Modal */}
      <AnimatePresence>
        {isRegisterModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0f1e3f]/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-10 overflow-hidden relative"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-[#ce7e27]" />
              <h3 className="text-2xl font-black uppercase tracking-tight mb-6">Registrar Voluntario</h3>
              
              <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">Nombre Completo</label>
                  <input 
                    type="text" 
                    value={newVolunteer.name}
                    onChange={(e) => setNewVolunteer({...newVolunteer, name: e.target.value})}
                    placeholder="Ej. Juan Pérez"
                    className="w-full px-6 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#ce7e27] outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3 block">Funciones Preferidas</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_FUNCTIONS.map(f => (
                      <button
                        key={f}
                        onClick={() => {
                          const current = newVolunteer.functions || [];
                          const next = current.includes(f) ? current.filter(x => x !== f) : [...current, f];
                          setNewVolunteer({...newVolunteer, functions: next});
                        }}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-2",
                          newVolunteer.functions?.includes(f) 
                            ? "bg-[#2e4f76] text-white border-[#2e4f76]" 
                            : "bg-white text-gray-600 border-gray-200 hover:border-[#ce7e27]"
                        )}
                      >
                        {getFunctionIcon(f)}
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3 block">Disponibilidad de Días</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_SERVICES.map(s => (
                      <button
                        key={s}
                        onClick={() => {
                          const current = newVolunteer.availability || [];
                          const next = current.includes(s) ? current.filter(x => x !== s) : [...current, s];
                          setNewVolunteer({...newVolunteer, availability: next});
                        }}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                          newVolunteer.availability?.includes(s) 
                            ? "bg-[#ce7e27] text-white border-[#ce7e27]" 
                            : "bg-white text-gray-600 border-gray-200 hover:border-[#ce7e27]"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">Restricciones o Notas</label>
                  <textarea 
                    value={newVolunteer.restrictions?.join('\n')}
                    onChange={(e) => setNewVolunteer({...newVolunteer, restrictions: e.target.value.split('\n')})}
                    placeholder="Ej. No puede el 15 de Marzo"
                    className="w-full px-6 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#ce7e27] outline-none transition-all min-h-[100px]"
                  />
                </div>
              </div>

              <div className="flex gap-4 mt-10">
                <button 
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="flex-1 py-4 rounded-2xl font-black uppercase tracking-widest text-gray-400 hover:bg-gray-100 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={registerVolunteer}
                  disabled={loading}
                  className="flex-1 bg-[#2e4f76] text-white py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-[#0f1e3f] transition-all shadow-xl shadow-[#2e4f76]/20 disabled:opacity-50"
                >
                  {loading ? 'Guardando...' : 'Registrar'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="w-12 h-1 bg-[#ce7e27] mx-auto mb-6 rounded-full" />
        <p className="text-[#0f1e3f] font-black uppercase tracking-[0.3em] text-[10px] opacity-40">
          © {new Date().getFullYear()} Iglesia - Equipo de Comunicaciones
        </p>
      </footer>
    </div>
  );
}
