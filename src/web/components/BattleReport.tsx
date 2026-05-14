import React, { useEffect } from 'react';
import { pickName, t } from '../../i18n/locale.js';
import type { City, Faction, General } from '../../engine/types.js';
import { factionColor } from '../theme.js';

export interface BattleReportData {
  // The two factions involved.
  attacker: Faction;
  defender: Faction | null;
  // Cities involved (origin + target).
  from: City;
  target: City;
  // Troops committed by the attacker.
  attackingTroops: number;
  // Generals on each side (snapshot taken before the engagement).
  attackingGenerals: General[];
  defendingGenerals: General[];
  // Defender troop count before the engagement (garrison + general troops).
  defendingTroops: number;
  // Result.
  attackerWon: boolean;
  attackerCasualties: number;
  defenderCasualties: number;
}

interface Props {
  data: BattleReportData;
  onClose: () => void;
}

export const BattleReport: React.FC<Props> = ({ data, onClose }) => {
  // Esc / Enter closes the report.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const verdict = data.attackerWon ? t('battle.victory') : t('battle.retreat');
  const verdictTone = data.attackerWon ? 'text-emerald-700' : 'text-seal-700';
  const summary = data.attackerWon
    ? t('battle.cityCaptured', { city: data.target.name })
    : t('battle.cityHeld', { city: data.target.name });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm">
      <div
        className="panel w-[min(40rem,92vw)]"
        role="dialog"
        aria-modal="true"
        aria-label={t('battle.report')}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg tracking-widest text-ink-800">
            {t('battle.report')}
          </h3>
          <span className={`font-display text-sm tracking-widest ${verdictTone}`}>
            {verdict}
          </span>
        </div>
        <div className="ink-divider my-2" />

        <div className="grid grid-cols-2 gap-3 text-sm">
          <BattleSide
            title={t('battle.attackers')}
            faction={data.attacker}
            city={data.from}
            cityLabel={t('battle.from')}
            troops={data.attackingTroops}
            casualties={data.attackerCasualties}
            generals={data.attackingGenerals}
            highlight={data.attackerWon}
          />
          <BattleSide
            title={t('battle.defenders')}
            faction={data.defender}
            city={data.target}
            cityLabel={t('battle.target')}
            troops={data.defendingTroops}
            casualties={data.defenderCasualties}
            generals={data.defendingGenerals}
            highlight={!data.attackerWon}
          />
        </div>

        <div className="ink-divider my-2" />
        <p className="text-sm text-ink-700">{summary}</p>

        <div className="mt-3 flex justify-end">
          <button className="btn btn-primary" onClick={onClose} autoFocus>
            {t('app.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------- side panel

interface BattleSideProps {
  title: string;
  faction: Faction | null;
  city: City;
  cityLabel: string;
  troops: number;
  casualties: number;
  generals: General[];
  highlight: boolean;
}

const BattleSide: React.FC<BattleSideProps> = ({
  title,
  faction,
  city,
  cityLabel,
  troops,
  casualties,
  generals,
  highlight,
}) => {
  const color = factionColor(faction?.id ?? null);
  const survivors = Math.max(0, troops - casualties);
  return (
    <div
      className={`rounded border px-3 py-2 ${
        highlight ? 'border-seal-500/50 bg-seal-500/5' : 'border-ink-300/50 bg-parchment-50/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="font-display text-[10px] uppercase tracking-widest text-ink-500">
          {title}
        </span>
      </div>
      <div className="mt-1 font-serif text-base font-semibold text-ink-800">
        {faction ? pickName(faction.name) : '—'}
      </div>
      <div className="text-xs text-ink-600">
        {cityLabel}: {pickName(city.name)}
      </div>
      <div className="ink-divider my-1.5" />
      <Row label={t('battle.troopsCommitted')} value={troops.toLocaleString()} />
      <Row
        label={t('battle.casualties')}
        value={`-${casualties.toLocaleString()}`}
        tone="bad"
      />
      <Row label={t('general.troops')} value={survivors.toLocaleString()} tone="dim" />
      <div className="mt-1 text-[11px] text-ink-500">{t('battle.generals')}</div>
      {generals.length === 0 ? (
        <div className="text-[11px] italic text-ink-500">{t('battle.noGenerals')}</div>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {generals.map((g) => (
            <li
              key={g.id}
              className="rounded border border-ink-300/40 bg-parchment-100 px-1.5 py-0.5 text-[11px]"
              title={`${pickName(g.name)} W${g.stats.wu}/I${g.stats.zhi}/C${g.stats.tong}`}
            >
              {pickName(g.name)}
              <span className="ml-1 text-ink-500">W{g.stats.wu}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; tone?: 'bad' | 'dim' }> = ({
  label,
  value,
  tone,
}) => (
  <div className="flex items-baseline justify-between gap-2 text-xs">
    <span className="text-ink-500">{label}</span>
    <span
      className={
        tone === 'bad'
          ? 'font-mono text-seal-700'
          : tone === 'dim'
            ? 'font-mono text-ink-500'
            : 'font-mono text-ink-800'
      }
    >
      {value}
    </span>
  </div>
);
