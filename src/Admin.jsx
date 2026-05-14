import { useState, useEffect, useMemo } from "react";
import { db } from "./firebase";
import { tocarSomDinheiro } from "./sons";
import {
  collection, onSnapshot, doc, updateDoc, addDoc,
  serverTimestamp, query, orderBy, deleteDoc, setDoc
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";

const C = {
  bg: "#0A0E1A", card: "#111827", border: "#1E293B",
  accent: "#F59E0B", green: "#10B981", red: "#EF4444",
  blue: "#3B82F6", purple: "#8B5CF6",
  text: "#F1F5F9", muted: "#64748B", surface: "#1E293B",
};

const ADMIN_UIDS = ["SEU_UID_ADMIN_AQUI"];

function gerarCodigo() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "IMOPRO-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function fmt(data) {
  if (!data) return "—";
  const d = data?.toDate?.() || new Date(data);
  return d.toLocaleDateString("pt-BR");
}

function diasRestantes(vencimento) {
  if (!vencimento) return null;
  const d = vencimento?.toDate?.() || new Date(vencimento);
  return Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
}

function diasAteExpirar(expiraEm) {
  if (!expiraEm) return null;
  const d = expiraEm?.toDate?.() || new Date(expiraEm);
  return Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
}

// ── Pill de status ──
function StatusBadge({ status }) {
  const map = {
    ativa:     { bg: "#064E3B", color: C.green,  label: "✅ Ativo" },
    trial:     { bg: "#422006", color: C.accent, label: "⏳ Trial" },
    cancelada: { bg: "#3B0000", color: C.red,    label: "❌ Cancelado" },
    expirada:  { bg: "#1E1B4B", color: C.purple, label: "🕐 Expirado" },
  };
  const s = map[status] || map.cancelada;
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 8, padding: "3px 10px",
      fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

// ── Card de métrica ──
function MetricCard({ valor, label, cor, sub }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: "14px 10px", textAlign: "center",
    }}>
      <div style={{ color: cor, fontSize: 20, fontWeight: 900 }}>{valor}</div>
      <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ color: cor, fontSize: 9, marginTop: 3, opacity: 0.7 }}>{sub}</div>}
    </div>
  );
}

export default function Admin({ user }) {
  const [aba, setAba] = useState("assinantes");
  const [assinantes, setAssinantes] = useState([]);
  const [codigos, setCodigos] = useState([]);
  const [gerandoCodigo, setGerandoCodigo] = useState(false);
  const [codigoGerado, setCodigoGerado] = useState(null);
  const [modalAlt, setModalAlt] = useState(null);
  const [diasExtra, setDiasExtra] = useState("30");
  const [diasCustom, setDiasCustom] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [copiado, setCopiado] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    const q1 = query(collection(db, "assinaturas"), orderBy("criadoEm", "desc"));
    const unsub1 = onSnapshot(q1, snap =>
      setAssinantes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const q2 = query(collection(db, "codigos_ativacao"), orderBy("criadoEm", "desc"));
    const unsub2 = onSnapshot(q2, snap =>
      setCodigos(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { unsub1(); unsub2(); };
  }, []);

  // ── Métricas ──
  const totalAtivos    = assinantes.filter(a => a.status === "ativa").length;
  const totalTrial     = assinantes.filter(a => a.status === "trial").length;
  const totalCancelado = assinantes.filter(a => a.status === "cancelada" || a.status === "expirada").length;
  const receitaMensal  = totalAtivos * 49;
  const codigosLivres  = codigos.filter(c => !c.usado).length;

  // Vencendo em até 7 dias
  const vencendoEmBreve = assinantes.filter(a => {
    if (a.status !== "ativa") return false;
    const d = diasRestantes(a.vencimento);
    return d !== null && d <= 7 && d >= 0;
  }).length;

  // ── Filtro de assinantes ──
  const assinantesFiltrados = useMemo(() => {
    return assinantes.filter(a => {
      const matchBusca = !busca ||
        (a.nome || "").toLowerCase().includes(busca.toLowerCase()) ||
        (a.email || "").toLowerCase().includes(busca.toLowerCase());
      const matchStatus = filtroStatus === "todos" || a.status === filtroStatus;
      return matchBusca && matchStatus;
    });
  }, [assinantes, busca, filtroStatus]);

  // ── Ações ──
  const getDias = () => {
    if (diasCustom && !isNaN(parseInt(diasCustom))) return parseInt(diasCustom);
    return parseInt(diasExtra) || 30;
  };

  const ativarManual = async (assinante) => {
    const dias = getDias();
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + dias);
    await updateDoc(doc(db, "assinaturas", assinante.id), {
      status: "ativa",
      ativa: true,
      plano: "mensal",
      vencimento,
      ativadoEm: serverTimestamp(),
      ativadoPor: "admin",
    });
    tocarSomDinheiro();
    setModalAlt(null);
    setDiasCustom("");
  };

  const cancelarAssinatura = async (assinante) => {
    if (!window.confirm(`Cancelar assinatura de ${assinante.nome || assinante.email}?`)) return;
    await updateDoc(doc(db, "assinaturas", assinante.id), {
      status: "cancelada",
      ativa: false,
      canceladoEm: serverTimestamp(),
    });
  };

  const gerarNovoCodigo = async () => {
    setGerandoCodigo(true);
    const codigo = gerarCodigo();
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 7);
    await setDoc(doc(db, "codigos_ativacao", codigo), {
      codigo,
      usado: false,
      criadoEm: serverTimestamp(),
      criadoPor: user.uid,
      expiraEm: vencimento,
    });
    setCodigoGerado(codigo);
    setGerandoCodigo(false);
  };

  const copiarCodigo = (codigo) => {
    navigator.clipboard.writeText(codigo);
    setCopiado(codigo);
    setTimeout(() => setCopiado(null), 2000);
  };

  const deletarCodigo = async (id) => {
    await deleteDoc(doc(db, "codigos_ativacao", id));
    setConfirmDelete(null);
  };

  return (
    <div style={{
      background: C.bg, minHeight: "100vh",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: "20px 16px", maxWidth: 500, margin: "0 auto",
    }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ color: C.accent, fontWeight: 900, fontSize: 20 }}>🛡️ Admin</div>
          <div style={{ color: C.muted, fontSize: 12 }}>ImóvelPro — Painel de Gestão</div>
        </div>
        <button onClick={() => signOut(auth)} style={{
          background: C.surface, border: "none", borderRadius: 10,
          padding: "8px 14px", color: C.muted, fontSize: 13, cursor: "pointer",
        }}>Sair</button>
      </div>

      {/* Métricas — 2 linhas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
        <MetricCard valor={totalAtivos}    label="ATIVOS"     cor={C.green}  />
        <MetricCard valor={totalTrial}     label="TRIAL"      cor={C.accent} />
        <MetricCard valor={`R$${receitaMensal}`} label="MRR"  cor={C.purple} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        <MetricCard valor={totalCancelado} label="CANCELADOS" cor={C.red} />
        <MetricCard
          valor={vencendoEmBreve}
          label="VENCENDO"
          cor={vencendoEmBreve > 0 ? C.accent : C.muted}
          sub={vencendoEmBreve > 0 ? "em 7 dias" : null}
        />
        <MetricCard valor={codigosLivres} label="CÓDIGOS" cor={C.blue} sub="disponíveis" />
      </div>

      {/* Abas */}
      <div style={{
        display: "flex", background: C.surface,
        borderRadius: 12, padding: 4, marginBottom: 20,
      }}>
        {[["assinantes", "👥 Assinantes"], ["codigos", "🔑 Códigos"]].map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)} style={{
            flex: 1, padding: "10px",
            background: aba === id ? C.accent : "transparent",
            color: aba === id ? "#0A0E1A" : C.muted,
            border: "none", borderRadius: 10,
            fontWeight: 700, cursor: "pointer", fontSize: 13,
          }}>{label}</button>
        ))}
      </div>

      {/* ── ABA ASSINANTES ── */}
      {aba === "assinantes" && (
        <div>
          {/* Busca + filtro */}
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="🔍 Buscar por nome ou e-mail..."
            style={{
              width: "100%", background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: "11px 14px", color: C.text,
              fontSize: 13, outline: "none", marginBottom: 10, boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {[["todos", "Todos"], ["ativa", "✅ Ativos"], ["trial", "⏳ Trial"], ["cancelada", "❌ Cancelados"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setFiltroStatus(val)} style={{
                background: filtroStatus === val ? C.accent : C.surface,
                color: filtroStatus === val ? "#0A0E1A" : C.muted,
                border: "none", borderRadius: 8, padding: "5px 12px",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>{lbl}</button>
            ))}
          </div>

          {assinantesFiltrados.length === 0 ? (
            <div style={{ color: C.muted, textAlign: "center", padding: 40 }}>
              {busca ? "Nenhum resultado encontrado" : "Nenhum assinante ainda"}
            </div>
          ) : assinantesFiltrados.map(a => {
            const dias = diasRestantes(a.vencimento);
            const vencendo = dias !== null && dias <= 7 && dias >= 0 && a.status === "ativa";
            return (
              <div key={a.id} style={{
                background: C.card,
                border: `1px solid ${vencendo ? C.accent + "66" : C.border}`,
                borderRadius: 14, padding: 16, marginBottom: 12,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                    <div style={{ color: C.text, fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.nome || a.email}
                    </div>
                    <div style={{ color: C.muted, fontSize: 11 }}>{a.email}</div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>

                {/* Info vencimento */}
                <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                  <div style={{ color: C.muted, fontSize: 11 }}>
                    📅 Vence: <span style={{ color: vencendo ? C.accent : C.text }}>{fmt(a.vencimento)}</span>
                    {dias !== null && a.status === "ativa" && (
                      <span style={{ color: vencendo ? C.accent : C.muted, marginLeft: 4 }}>
                        ({dias <= 0 ? "vencida" : `${dias}d`})
                      </span>
                    )}
                  </div>
                  <div style={{ color: C.muted, fontSize: 11 }}>
                    🗓 Cadastro: {fmt(a.criadoEm)}
                  </div>
                </div>

                {/* Alerta vencendo */}
                {vencendo && (
                  <div style={{
                    background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
                    borderRadius: 8, padding: "6px 10px", marginBottom: 10,
                    color: C.accent, fontSize: 11, fontWeight: 600,
                  }}>
                    ⚠️ Vence em {dias} dia{dias !== 1 ? "s" : ""} — considere renovar
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setModalAlt(a)} style={{
                    background: "#064E3B", border: "none", borderRadius: 8,
                    padding: "7px 14px", color: C.green, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                    {a.status === "ativa" ? "🔄 Renovar" : "✅ Ativar"}
                  </button>
                  {a.status !== "cancelada" && (
                    <button onClick={() => cancelarAssinatura(a)} style={{
                      background: "#3B0000", border: "none", borderRadius: 8,
                      padding: "7px 14px", color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>❌ Cancelar</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ABA CÓDIGOS ── */}
      {aba === "codigos" && (
        <div>
          <button onClick={gerarNovoCodigo} disabled={gerandoCodigo} style={{
            background: C.accent, border: "none", borderRadius: 12,
            padding: "14px 24px", color: "#0A0E1A", fontWeight: 800,
            fontSize: 15, cursor: "pointer", width: "100%", marginBottom: 16,
          }}>
            {gerandoCodigo ? "Gerando..." : "🔑 Gerar Novo Código"}
          </button>

          {codigoGerado && (
            <div style={{
              background: "#064E3B", border: `1px solid ${C.green}`,
              borderRadius: 14, padding: 16, marginBottom: 16, textAlign: "center",
            }}>
              <div style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>Código gerado:</div>
              <div style={{ color: C.green, fontSize: 22, fontWeight: 900, letterSpacing: 2 }}>{codigoGerado}</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>Válido por 7 dias</div>
              <button onClick={() => copiarCodigo(codigoGerado)} style={{
                background: C.green, border: "none", borderRadius: 8,
                padding: "8px 20px", color: "#fff", fontWeight: 700,
                fontSize: 13, cursor: "pointer", marginTop: 12,
              }}>
                {copiado === codigoGerado ? "✅ Copiado!" : "📋 Copiar Código"}
              </button>
            </div>
          )}

          {/* Resumo */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ color: C.green, fontWeight: 800 }}>{codigosLivres}</div>
              <div style={{ color: C.muted, fontSize: 10 }}>Disponíveis</div>
            </div>
            <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ color: C.muted, fontWeight: 800 }}>{codigos.filter(c => c.usado).length}</div>
              <div style={{ color: C.muted, fontSize: 10 }}>Usados</div>
            </div>
          </div>

          {codigos.map(c => {
            const diasExp = diasAteExpirar(c.expiraEm);
            const expirado = !c.usado && diasExp !== null && diasExp < 0;
            return (
              <div key={c.id} style={{
                background: C.card,
                border: `1px solid ${c.usado ? C.border : expirado ? C.red + "44" : C.border}`,
                borderRadius: 12, padding: "12px 14px", marginBottom: 10,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: c.usado || expirado ? C.muted : C.text,
                    fontWeight: 700, fontSize: 14, letterSpacing: 1,
                    textDecoration: c.usado ? "line-through" : "none",
                  }}>{c.codigo}</div>
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                    Criado: {fmt(c.criadoEm)}
                    {!c.usado && diasExp !== null && (
                      <span style={{ marginLeft: 8, color: expirado ? C.red : diasExp <= 2 ? C.accent : C.muted }}>
                        • {expirado ? "Expirado" : `Expira em ${diasExp}d`}
                      </span>
                    )}
                    {c.usado && c.usadoEm && (
                      <span style={{ marginLeft: 8 }}>• Usado em {fmt(c.usadoEm)}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  <span style={{
                    background: c.usado ? "#3B0000" : expirado ? "#3B0000" : "#064E3B",
                    color: c.usado || expirado ? C.red : C.green,
                    borderRadius: 8, padding: "3px 9px", fontSize: 10, fontWeight: 700,
                  }}>
                    {c.usado ? "Usado" : expirado ? "Expirado" : "Livre"}
                  </span>
                  {!c.usado && (
                    <button onClick={() => copiarCodigo(c.codigo)} style={{
                      background: C.surface, border: "none", borderRadius: 8,
                      padding: "5px 9px", color: C.text, fontSize: 12, cursor: "pointer",
                    }}>
                      {copiado === c.codigo ? "✅" : "📋"}
                    </button>
                  )}
                  {/* Deletar código não usado */}
                  <button onClick={() => setConfirmDelete(c)} style={{
                    background: "#3B0000", border: "none", borderRadius: 8,
                    padding: "5px 9px", color: C.red, fontSize: 12, cursor: "pointer",
                  }}>🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ativar/renovar ── */}
      {modalAlt && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
          zIndex: 200, display: "flex", alignItems: "center",
          justifyContent: "center", padding: 20,
        }}>
          <div style={{ background: C.card, borderRadius: 20, padding: 24, width: "100%", maxWidth: 360 }}>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
              {modalAlt.status === "ativa" ? "🔄 Renovar assinatura" : "✅ Ativar assinatura"}
            </div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>
              {modalAlt.nome || modalAlt.email}
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ color: C.muted, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Dias de acesso:
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {["30", "60", "90"].map(d => (
                  <button key={d} onClick={() => { setDiasExtra(d); setDiasCustom(""); }} style={{
                    flex: 1, padding: "10px 0",
                    background: diasExtra === d && !diasCustom ? C.green : C.surface,
                    color: diasExtra === d && !diasCustom ? "#fff" : C.muted,
                    border: "none", borderRadius: 10, fontWeight: 700,
                    cursor: "pointer", fontSize: 14,
                  }}>{d}d</button>
                ))}
              </div>
              <input
                type="number"
                value={diasCustom}
                onChange={e => setDiasCustom(e.target.value)}
                placeholder="Ou digite um número personalizado..."
                style={{
                  width: "100%", background: C.surface, border: `1px solid ${diasCustom ? C.accent : C.border}`,
                  borderRadius: 10, padding: "10px 14px", color: C.text,
                  fontSize: 13, outline: "none", boxSizing: "border-box",
                }}
              />
              {(diasCustom || diasExtra) && (
                <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>
                  ➜ Vencerá em <span style={{ color: C.accent, fontWeight: 700 }}>
                    {(() => {
                      const d = new Date();
                      d.setDate(d.getDate() + getDias());
                      return d.toLocaleDateString("pt-BR");
                    })()}
                  </span> ({getDias()} dias)
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setModalAlt(null); setDiasCustom(""); }} style={{
                flex: 1, background: C.surface, border: "none",
                borderRadius: 12, padding: 14, color: C.text, fontWeight: 700, cursor: "pointer",
              }}>Cancelar</button>
              <button onClick={() => ativarManual(modalAlt)} style={{
                flex: 1, background: C.green, border: "none",
                borderRadius: 12, padding: 14, color: "#fff", fontWeight: 700, cursor: "pointer",
              }}>
                {modalAlt.status === "ativa" ? "🔄 Renovar" : "✅ Ativar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal confirmar deleção de código ── */}
      {confirmDelete && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
          zIndex: 200, display: "flex", alignItems: "center",
          justifyContent: "center", padding: 20,
        }}>
          <div style={{ background: C.card, borderRadius: 20, padding: 24, width: "100%", maxWidth: 320, textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Deletar código?</div>
            <div style={{ color: C.red, fontWeight: 700, fontSize: 18, letterSpacing: 2, marginBottom: 6 }}>
              {confirmDelete.codigo}
            </div>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 20 }}>Esta ação não pode ser desfeita.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{
                flex: 1, background: C.surface, border: "none", borderRadius: 12,
                padding: 13, color: C.text, fontWeight: 700, cursor: "pointer",
              }}>Cancelar</button>
              <button onClick={() => deletarCodigo(confirmDelete.id)} style={{
                flex: 1, background: C.red, border: "none", borderRadius: 12,
                padding: 13, color: "#fff", fontWeight: 700, cursor: "pointer",
              }}>🗑 Deletar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function getDias() {
    if (diasCustom && !isNaN(parseInt(diasCustom))) return parseInt(diasCustom);
    return parseInt(diasExtra) || 30;
  }
}
