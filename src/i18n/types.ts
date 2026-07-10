// i18n primitive types.

export type Locale = 'zh' | 'en';

export type LocalizedString = { zh: string; en: string };

// Every user-facing string in the codebase has a stable key. The engine
// emits these (along with a `vars` map for interpolation) into log entries;
// the UI resolves them with `t(key, vars)` against the active locale.
//
// Keep this union exhaustive. The CI test in tests/i18n/parity.test.ts
// asserts both catalogs cover the entire union.
export type MessageKey =
  // App chrome
  | 'app.title'
  | 'app.subtitle'
  | 'app.pressKey'
  | 'app.confirm'
  | 'app.cancel'
  | 'app.yes'
  | 'app.no'
  | 'app.back'
  | 'app.continue'
  | 'app.quitConfirm'

  // Title screen
  | 'title.newGame'
  | 'title.loadGame'
  | 'title.about'
  | 'title.quit'

  // Scenario select
  | 'scenarioSelect.heading'
  | 'scenarioSelect.todoBadge'

  // Faction select
  | 'factionSelect.heading'
  | 'factionSelect.difficulty'
  | 'factionSelect.cities'
  | 'factionSelect.generals'

  // Status bar
  | 'status.year'
  | 'status.month'
  | 'status.faction'
  | 'status.money'
  | 'status.food'
  | 'status.troops'
  | 'status.cities'
  | 'status.month_long'

  // Sidebar / city panel
  | 'sidebar.city'
  | 'sidebar.faction'
  | 'sidebar.agriculture'
  | 'sidebar.commerce'
  | 'sidebar.defense'
  | 'sidebar.loyalty'
  | 'sidebar.garrison'
  | 'sidebar.generals'
  | 'sidebar.adjacent'
  | 'sidebar.terrain'
  | 'sidebar.empty'

  // General card
  | 'general.wu'
  | 'general.zhi'
  | 'general.tong'
  | 'general.zheng'
  | 'general.loyalty'
  | 'general.age'
  | 'general.troops'
  | 'general.troopType'
  | 'general.equipment'

  // Troop types
  | 'troop.infantry'
  | 'troop.archer'
  | 'troop.cavalry'
  | 'troop.heavyCav'
  | 'troop.navy'
  | 'troop.xuan'

  // Terrain
  | 'terrain.plain'
  | 'terrain.mountain'
  | 'terrain.forest'
  | 'terrain.river'
  | 'terrain.city'

  // Personality
  | 'personality.active'
  | 'personality.balanced'
  | 'personality.turtle'

  // Command menu
  | 'menu.heading'
  | 'menu.internalAffairs'
  | 'menu.military'
  | 'menu.diplomacy'
  | 'menu.search'
  | 'menu.saveLoad'
  | 'menu.help'
  | 'menu.endTurn'
  | 'menu.develop'
  | 'menu.commerce'
  | 'menu.govern'
  | 'menu.patrol'
  | 'menu.recruit'
  | 'menu.plunder'
  | 'menu.attack'
  | 'menu.move'

  // Events
  | 'event.guandongCoalition'
  | 'event.qianduChangan'
  | 'event.xunRecommendsGuo'
  | 'event.tongxiaoFound'
  | 'event.nanfangFound'
  | 'event.rebellion'
  | 'event.wildGeneralFound'
  | 'event.generalDied'
  | 'event.cityFell'
  | 'event.attackerRetreated'
  | 'event.defenderRetreated'
  | 'event.duelStart'
  | 'event.duelWin'
  | 'event.defected'
  | 'event.generalMoved'
  | 'event.scenarioComplete'

  // Defection
  | 'defect.title'
  | 'defect.cost'
  | 'defect.offer'
  | 'defect.payFrom'
  | 'defect.cannotLord'
  | 'defect.notAdjacent'
  | 'defect.notEnoughGold'
  | 'defect.success'
  | 'defect.failed'
  | 'defect.button'

  // Transfer / move
  | 'transfer.title'
  | 'transfer.target'
  | 'transfer.troops'
  | 'transfer.button'
  | 'transfer.noTarget'
  | 'transfer.done'

  // Generals overview
  | 'generals.title'
  | 'generals.atCity'
  | 'generals.recentActivity'
  | 'generals.noActivity'
  | 'generals.action.develop'
  | 'generals.action.commerce'
  | 'generals.action.govern'
  | 'generals.action.patrol'
  | 'generals.action.search'
  | 'generals.action.attack'
  | 'generals.action.move'
  | 'generals.action.defect'
  | 'generals.action.recruit'

  // Internal affairs results
  | 'result.developed'
  | 'result.commerceUp'
  | 'result.governed'
  | 'result.patrolled'
  | 'result.searched'
  | 'result.recruited'

  // Battle screen
  | 'battle.day'
  | 'battle.attackers'
  | 'battle.defenders'
  | 'battle.timeoutWarning'

  // Battle report dialog
  | 'battle.report'
  | 'battle.outcome'
  | 'battle.victory'
  | 'battle.retreat'
  | 'battle.casualties'
  | 'battle.troopsCommitted'
  | 'battle.cityCaptured'
  | 'battle.cityHeld'
  | 'battle.generals'
  | 'battle.noGenerals'
  | 'battle.against'
  | 'battle.from'
  | 'battle.target'
  | 'battle.heading'
  | 'battle.morale'
  | 'battle.advanceDay'
  | 'battle.play'
  | 'battle.pause'
  | 'battle.quickResolve'
  | 'battle.speed'
  | 'battle.yourOrders'
  | 'battle.gambits'
  | 'battle.commitReserves'
  | 'battle.charge'
  | 'battle.hold'
  | 'battle.advance'
  | 'battle.finish'
  | 'battle.victoryTitle'
  | 'battle.defeatTitle'
  | 'battle.caption.fire'
  | 'battle.caption.flood'
  | 'battle.caption.duel'
  | 'battle.caption.rout'
  | 'battle.caption.charge'
  | 'battle.caption.clash'
  | 'battle.caption.volley'
  | 'battle.intro.tag'
  | 'battle.intro.title'
  | 'battle.intro.era'
  | 'battle.intro.commanders'
  | 'battle.intro.garrison'
  | 'battle.intro.narr'
  | 'battle.intro.begin'
  | 'battle.act.deploy'
  | 'battle.act.engage'
  | 'battle.act.decide'
  | 'battle.narr.deploy'
  | 'battle.narr.volley'
  | 'battle.narr.clash'
  | 'battle.narr.charge'
  | 'battle.narr.fire'
  | 'battle.narr.flood'
  | 'battle.narr.duel'
  | 'battle.narr.rout'
  | 'battle.reveal.tag'
  | 'battle.reveal.cavalryCharge'
  | 'battle.reveal.fireAttack'
  | 'battle.reveal.floodAttack'
  | 'battle.reveal.duelChallenge'
  | 'battle.reveal.fordCrossing'
  | 'battle.reveal.ambush'
  | 'battle.mute'
  | 'battle.unmute'
  | 'battle.gambit.cavalryCharge'
  | 'battle.gambit.fireAttack'
  | 'battle.gambit.floodAttack'
  | 'battle.gambit.duelChallenge'
  | 'battle.gambit.fordCrossing'
  | 'battle.gambit.ambush'

  // Battle animation
  | 'battle.engaging'
  | 'battle.dayOf'
  | 'battle.troops'
  | 'battle.skipHint'

  // Pending operations
  | 'op.scheduled'
  | 'op.heading'
  | 'op.daysRemaining'
  | 'op.develop'
  | 'op.commerce'
  | 'op.govern'
  | 'op.patrol'
  | 'op.search'
  | 'op.recruit'
  | 'op.plunder'
  | 'op.defect'
  | 'op.march'
  | 'op.siege'
  | 'op.empty'
  | 'op.intent.attack'
  | 'op.intent.reinforce'

  // Action result dialog (internal affairs feedback)
  | 'action.report'
  | 'action.govern.title'
  | 'action.develop.title'
  | 'action.commerce.title'
  | 'action.patrol.title'
  | 'action.search.title'
  | 'action.recruit.title'
  | 'action.executor'
  | 'action.target'
  | 'action.delta'
  | 'action.found'
  | 'action.nothingFound'
  | 'action.noChange'
  | 'action.cost'

  // Save / load
  | 'save.heading'
  | 'save.slot'
  | 'save.empty'
  | 'save.autosave'
  | 'save.saved'
  | 'save.loaded'
  | 'save.failed'

  // Help overlay
  | 'help.heading'
  | 'help.move'
  | 'help.select'
  | 'help.back'
  | 'help.endTurn'
  | 'help.menu'
  | 'help.build'
  | 'help.attack'
  | 'help.inspect'
  | 'help.save'
  | 'help.load'
  | 'help.lang'
  | 'help.helpOverlay'
  | 'help.quit'

  // Game over
  | 'over.victory'
  | 'over.defeat'
  | 'over.unifyAchieved'
  | 'over.dominateAchieved'

  // Generic
  | 'common.units'
  | 'common.gold'
  | 'common.grain'

  // World news feed
  | 'news.heading'
  | 'news.filter.all'
  | 'news.filter.mine'
  | 'news.filter.world'
  | 'news.empty'

  // Faction power panel
  | 'faction.rankHeading'
  | 'faction.you'
  | 'faction.eliminated'

  // Campaign map (3D) legend
  | 'map.legend.title'
  | 'map.legend.territory'
  | 'map.legend.province'
  | 'map.legend.city'
  | 'map.legend.capital'

  // Between-turn digest
  | 'digest.heading'
  | 'digest.dismiss';

export type MessageCatalog = Record<MessageKey, string>;
