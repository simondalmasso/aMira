'use client';

import { useHedgeFundStore } from '@/store/hedge-fund-store';
import { motion } from 'framer-motion';
import {
  RefreshCw,
  Copy,
  Download,
  Zap,
  RotateCw,
} from 'lucide-react';
import { useState } from 'react';

interface ActionButtonsProps {
  onRebalance: () => void;
  isRebalancing: boolean;
  onSync: () => void;
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
}

export function ActionButtons({ onRebalance, isRebalancing, onSync, syncStatus }: ActionButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const { allocations, metrics, lastSync } = useHedgeFundStore();

  const handleCopy = () => {
    const text = allocations
      .map(a => `${a.productName}: ${(a.weight * 100).toFixed(1)}% ($${a.amountUSD} USD)`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExport = () => {
    const json = JSON.stringify({
      timestamp: new Date().toISOString(),
      capital: 2000,
      currency: 'USD',
      allocations: allocations.map(a => ({
        product: a.productId,
        name: a.productName,
        weight: `${(a.weight * 100).toFixed(1)}%`,
        amountUSD: a.amountUSD,
        amountARS: a.amountARS,
      })),
      metrics,
      lastSync,
    }, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hedge-fund-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <div className="mt-6 space-y-3">
      {/* Acción Principal */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={onRebalance}
        disabled={isRebalancing}
        className={`w-full py-4 rounded-xl flex items-center justify-center gap-3 font-extrabold text-[14px] tracking-[0.12em] transition-all ${
          isRebalancing
            ? 'bg-[#eaeaea] text-[#999999]'
            : 'bg-[#000000] text-[#ffffff] active:bg-[#333333]'
        }`}
      >
        {isRebalancing ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Optimizando...
          </>
        ) : (
          <>
            <Zap className="w-4 h-4" />
            REBALANCEAR
          </>
        )}
      </motion.button>

      {/* Acciones Secundarias */}
      <div className="grid grid-cols-3 gap-2">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onSync}
          className="py-3.5 rounded-xl border border-[#eaeaea] hover:bg-[#fafafa] flex flex-col items-center justify-center gap-1.5 transition-all"
        >
          <RotateCw className={`w-4 h-4 text-[#000000] ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
          <span className="text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em]">
            {syncStatus === 'syncing' ? 'Sincronizando' : syncStatus === 'success' ? 'Listo' : 'Sincronizar'}
          </span>
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleCopy}
          className="py-3.5 rounded-xl border border-[#eaeaea] hover:bg-[#fafafa] flex flex-col items-center justify-center gap-1.5 transition-all"
        >
          <Copy className="w-4 h-4 text-[#000000]" />
          <span className="text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em]">
            {copied ? 'Copiado' : 'Copiar'}
          </span>
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleExport}
          className="py-3.5 rounded-xl border border-[#eaeaea] hover:bg-[#fafafa] flex flex-col items-center justify-center gap-1.5 transition-all"
        >
          <Download className="w-4 h-4 text-[#000000]" />
          <span className="text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em]">
            {exported ? 'Guardado' : 'Exportar'}
          </span>
        </motion.button>
      </div>

      {/* Indicador auto-sync */}
      <div className="flex items-center justify-center gap-2 pt-1">
        <div className="w-2 h-2 rounded-full bg-[#000000] animate-pulse" />
        <span className="text-[11px] font-medium text-[#999999]">
          Auto-sync cada 60s
        </span>
      </div>
    </div>
  );
}
