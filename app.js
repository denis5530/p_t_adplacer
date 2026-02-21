/**
 * AdPlacer — Тарифы. State and UI logic.
 * Сценарии: нет тарифа, активный, автопродление, недостаточно монет, заканчивается скоро.
 */

(function () {
  const TARIFFS = {
    starter: { name: 'Старт', price: 490, limits: '1 автозагрузка / 500 объявлений' },
    basic: { name: 'Базовый', price: 1490, limits: '1 автозагрузка / 50 000 объявлений' },
    advanced: { name: 'Продвинутый', price: 3490, originalPrice: 4470, discount: 20, limits: '3 автозагрузки / 150 000 объявлений' },
    professional: { name: 'Профессиональный', price: 8940, originalPrice: 14900, discount: 40, limits: '10 автозагрузок / 500 000 объявлений' }
  };

  const TIER_ORDER = ['starter', 'basic', 'advanced', 'professional'];

  const state = {
    hasTariff: true,
    currentTier: 'advanced',
    endDate: '28.02.2026',
    endTime: '23:59',
    paidAt: '26.02.2026 14:30',
    nextChargeDate: '28.02.2026',
    nextChargeTime: '23:59',
    balance: 5000,
    autoRenew: true,
    endingSoonDays: null,
    upgradeTargetTier: null,
    tariffsExpanded: false,
    toastTimer: null,
    pendingTopUpAmount: null,
    paymentMethod: 'balance'
  };

  const formatCoins = (n) => n.toLocaleString('ru-RU') + ' монет';
  const formatRubles = (n) => n.toLocaleString('ru-RU') + ' ₽';

  /** Длина периода подписки в днях (для прорata) */
  const PERIOD_DAYS = 30;

  /** Форматирует дату в DD.MM.YYYY */
  function formatDateDDMMYYYY(date) {
    var d = date.getDate();
    var m = date.getMonth() + 1;
    var y = date.getFullYear();
    return (d < 10 ? '0' : '') + d + '.' + (m < 10 ? '0' : '') + m + '.' + y;
  }

  /** Для input type="date": YYYY-MM-DD */
  function formatDateToInput(date) {
    var d = date.getDate();
    var m = date.getMonth() + 1;
    var y = date.getFullYear();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  /** Парсит строку YYYY-MM-DD в Date (локальная полночь) */
  function parseInputDate(str) {
    if (!str || str.length < 10) return null;
    var parts = str.split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    var date = new Date(y, m, d);
    if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) return null;
    return date;
  }

  /** Форматирует время HH:mm */
  function formatTimeHHmm(date) {
    var h = date.getHours();
    var min = date.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
  }

  /** Форматирует дату и время DD.MM.YYYY HH:mm */
  function formatDateTime(date) {
    return formatDateDDMMYYYY(date) + ' ' + formatTimeHHmm(date);
  }

  /** Тариф действует ровно 30 суток с момента оплаты. Вычисляет end по paidAt. */
  function getEndFromPaidAt(paidAtStr) {
    var parts = paidAtStr.split(' ');
    var d = parseEndDate(parts[0]);
    if (!d) return null;
    if (parts[1]) {
      var t = parts[1].split(':');
      if (t.length >= 2) {
        d.setHours(parseInt(t[0], 10), parseInt(t[1], 10), 0, 0);
      }
    }
    d.setTime(d.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);
    return d;
  }

  /** Парсит дату из формата DD.MM.YYYY */
  function parseEndDate(str) {
    if (!str) return null;
    var parts = str.trim().split(/[.\-/]/);
    if (parts.length !== 3) return null;
    var d = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var y = parseInt(parts[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
    var date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Расчёт стоимости улучшения тарифа.
   * — Первый тариф: полная цена.
   * — Апгрейд: прорata за оставшиеся дни периода (разница тарифов × доля оставшихся дней).
   */
  function getUpgradeCost(targetTier) {
    if (!targetTier || !TARIFFS[targetTier]) return { coins: 0, isProrated: false, remainingDays: 0, fullPrice: 0 };
    var newPrice = TARIFFS[targetTier].price;
    if (!state.hasTariff || isTariffExpired()) {
      return { coins: newPrice, isProrated: false, remainingDays: PERIOD_DAYS, fullPrice: newPrice };
    }
    var currentPrice = TARIFFS[state.currentTier] ? TARIFFS[state.currentTier].price : 0;
    if (TIER_ORDER.indexOf(targetTier) <= TIER_ORDER.indexOf(state.currentTier)) {
      return { coins: 0, isProrated: false, remainingDays: 0, fullPrice: newPrice };
    }
    var endDate = parseEndDate(state.endDate);
    if (!endDate) {
      return { coins: Math.max(0, newPrice - currentPrice), isProrated: false, remainingDays: 0, fullPrice: newPrice };
    }
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    var remainingDays = Math.max(0, Math.ceil((endDate - today) / (24 * 60 * 60 * 1000)));
    if (remainingDays <= 0) {
      return { coins: newPrice, isProrated: false, remainingDays: 0, fullPrice: newPrice };
    }
    var priceDiff = newPrice - currentPrice;
    var proratedCoins = Math.round(priceDiff * (remainingDays / PERIOD_DAYS));
    return {
      coins: Math.max(0, proratedCoins),
      isProrated: true,
      remainingDays: remainingDays,
      fullPrice: newPrice
    };
  }

  function isTariffExpired() {
    if (!state.hasTariff) return false;
    var endDate = parseEndDate(state.endDate);
    if (!endDate) return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    return endDate < today;
  }

  function getEl(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }
  function qsAll(sel) { return document.querySelectorAll(sel); }

  function toggleHidden(el, hide) {
    if (!el) return;
    if (hide) el.classList.add('hidden'); else el.classList.remove('hidden');
  }

  function renderBalance() {
    const balanceEl = getEl('balanceValue');
    const warningBlock = getEl('balanceWarning');
    const btnTopUp = getEl('btnTopUp');
    if (balanceEl) balanceEl.textContent = formatCoins(state.balance);
    const showWarning = state.hasTariff && !isTariffExpired() && state.autoRenew && state.balance < (TARIFFS[state.currentTier]?.price ?? 0);
    toggleHidden(warningBlock, !showWarning);
    toggleHidden(btnTopUp, showWarning);
  }

  function renderNoTariffBlock() {
    const block = getEl('noTariffBlock');
    const currentBlock = getEl('currentTariffBlock');
    toggleHidden(block, state.hasTariff);
    toggleHidden(currentBlock, !state.hasTariff);
  }

  function renderCurrentTariff() {
    if (!state.hasTariff) return;
    const t = TARIFFS[state.currentTier];
    if (!t) return;

    var expired = isTariffExpired();
    getEl('currentTariffName').textContent = expired ? 'Неактивен' : t.name;
    const upgradeBtn = getEl('btnUpgradeTariff');
    upgradeBtn.textContent = state.tariffsExpanded ? 'Скрыть тарифы' : (expired ? 'Подключить тариф' : 'Улучшить тариф');
    upgradeBtn.className = 'btn btn--sm ' + (state.tariffsExpanded ? 'btn--secondary' : 'btn--primary');
    toggleHidden(getEl('currentTariffExpand'), !state.tariffsExpanded);
    getEl('currentTariffEnd').textContent = state.endDate + ' ' + (state.endTime || '23:59');
    toggleHidden(getEl('currentTariffAutorenew'), expired);
    if (!expired) getEl('autorenewToggle').checked = state.autoRenew;

    const statusBadge = getEl('currentTariffStatus');
    var endDateParsed = parseEndDate(state.endDate);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    if (endDateParsed) {
      endDateParsed.setHours(0, 0, 0, 0);
      if (endDateParsed < today) {
        statusBadge.textContent = 'Истёк';
        statusBadge.className = 'badge badge--expired';
      } else if (state.endingSoonDays != null && state.endingSoonDays <= 7) {
        statusBadge.textContent = 'Заканчивается скоро';
        statusBadge.className = 'badge badge--ending-soon';
      } else {
        statusBadge.textContent = 'Активен до';
        statusBadge.className = 'badge badge--active';
      }
    } else {
      statusBadge.textContent = 'Активен до';
      statusBadge.className = 'badge badge--active';
    }

    if (!expired) {
      const labelStatus = getEl('autorenewLabelStatus');
      if (labelStatus) {
        labelStatus.textContent = state.autoRenew ? '(включено)' : '(отключено)';
        labelStatus.className = 'toggle-row__status' + (state.autoRenew ? ' toggle-row__status--on' : '');
      }
      const details = getEl('autorenewDetails');
      toggleHidden(details, !state.autoRenew);
    }

    if (state.autoRenew && !expired) {
      getEl('nextChargeDate').textContent = state.nextChargeDate + ' ' + (state.nextChargeTime || '23:59');
      getEl('renewalCost').textContent = formatCoins(t.price);
      const enough = state.balance >= t.price;
      toggleHidden(getEl('renewalInsufficient'), enough);
      toggleHidden(getEl('renewalOk'), !enough);
    }
  }

  function getButtonConfig(tier) {
    if (!state.hasTariff || isTariffExpired()) return { text: 'Выбрать тариф', action: 'choose', disabled: false };
    if (tier === state.currentTier) return { text: 'Текущий тариф', action: 'current', disabled: true };
    const currentIdx = TIER_ORDER.indexOf(state.currentTier);
    const tierIdx = TIER_ORDER.indexOf(tier);
    if (tierIdx < currentIdx) return { text: 'Недоступно', action: 'downgrade', disabled: true };
    return { text: 'Расширить тариф', action: 'upgrade', disabled: false };
  }

  function renderTariffCards() {
    qsAll('.tariff-card').forEach((card) => {
      const tier = card.dataset.tier;
      const btn = card.querySelector('.tariff-card__btn');
      const cfg = getButtonConfig(tier);
      btn.textContent = cfg.text;
      btn.disabled = cfg.disabled;
      btn.dataset.action = cfg.action;
      btn.className = 'btn ' + (cfg.action === 'upgrade' || (cfg.action === 'choose' && state.hasTariff) ? 'btn--primary' : 'btn--secondary') + ' tariff-card__btn';
      card.classList.toggle('tariff-card--current', tier === state.currentTier && state.hasTariff);
    });
  }

  function getPaymentPrice() {
    return getUpgradeCost(state.upgradeTargetTier).coins;
  }

  function getBalanceEnough() {
    return state.balance >= getPaymentPrice();
  }

  function openPaymentModal(targetTier) {
    state.upgradeTargetTier = targetTier;
    var cost = getUpgradeCost(targetTier);
    var price = cost.coins;
    var to = TARIFFS[targetTier];
    state.paymentMethod = getBalanceEnough() ? 'balance' : 'sbp';
    getEl('paymentModalTitle').textContent = state.hasTariff ? 'Оплата тарифа' : 'Оплата тарифа';
    if (cost.isProrated && cost.remainingDays > 0) {
      getEl('paymentSummary').textContent = 'Тариф ' + to.name + ' — ' + formatCoins(price) + ' (доплата за ' + cost.remainingDays + ' дн. разницы стоимости тарифов)';
    } else {
      getEl('paymentSummary').textContent = 'Тариф ' + to.name + ' — ' + formatCoins(price);
    }
    getEl('paymentBalance').textContent = formatCoins(state.balance);
    getEl('paymentCostCoins').textContent = formatCoins(price);
    getEl('paymentCostRubles').textContent = formatRubles(price);
    updatePaymentMethodCards();
    updatePaymentDetail();
    getEl('paymentModal').classList.remove('hidden');
  }

  function closePaymentModal() {
    getEl('paymentModal').classList.add('hidden');
    state.upgradeTargetTier = null;
  }

  function updatePaymentMethodCards() {
    qsAll('.payment-method-card').forEach(function (card) {
      card.classList.toggle('payment-method-card--active', card.dataset.method === state.paymentMethod);
    });
  }

  function updatePaymentDetail() {
    const price = getPaymentPrice();
    const enough = getBalanceEnough();
    toggleHidden(getEl('paymentDetailBalance'), state.paymentMethod !== 'balance');
    toggleHidden(getEl('paymentDetailSbp'), state.paymentMethod !== 'sbp');
    if (state.paymentMethod === 'balance') {
      getEl('paymentBalance').textContent = formatCoins(state.balance);
      getEl('paymentCostCoins').textContent = formatCoins(price);
      toggleHidden(getEl('paymentBalanceOk'), !enough);
      toggleHidden(getEl('paymentBalanceLow'), enough);
      getEl('paymentBtnBalance').disabled = !enough;
    }
    if (state.paymentMethod === 'sbp') {
      getEl('paymentCostRubles').textContent = formatRubles(price);
    }
  }

  function openConfirmBalanceModal() {
    const price = getPaymentPrice();
    getEl('confirmBalanceText').textContent = 'Будет списано ' + formatCoins(price) + ' с вашего баланса. Вы уверены?';
    getEl('confirmBalanceModal').classList.remove('hidden');
  }

  function closeConfirmBalanceModal() {
    getEl('confirmBalanceModal').classList.add('hidden');
  }

  function setTariffPeriodFromNow() {
    var now = new Date();
    state.paidAt = formatDateTime(now);
    var end = new Date(now.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);
    state.endDate = formatDateDDMMYYYY(end);
    state.endTime = formatTimeHHmm(end);
    state.nextChargeDate = state.endDate;
    state.nextChargeTime = state.endTime;
  }

  function applyBalancePayment() {
    if (!state.upgradeTargetTier) return;
    const price = getPaymentPrice();
    if (state.balance < price) return;
    var cost = getUpgradeCost(state.upgradeTargetTier);
    state.balance -= price;
    state.currentTier = state.upgradeTargetTier;
    if (!state.hasTariff) state.hasTariff = true;
    if (!(cost.isProrated && cost.remainingDays > 0)) setTariffPeriodFromNow();
    state.upgradeTargetTier = null;
    closeConfirmBalanceModal();
    closePaymentModal();
    closeTariffsChoice();
    render();
    showToast('Оплата успешно выполнена');
  }

  function openTariffQrModal() {
    const price = getPaymentPrice();
    getEl('tariffQrAmount').textContent = formatRubles(price);
    getEl('tariffQrModal').classList.remove('hidden');
  }

  function closeTariffQrModal() {
    getEl('tariffQrModal').classList.add('hidden');
  }

  function applyTariffAfterSbp() {
    if (!state.upgradeTargetTier) return;
    var cost = getUpgradeCost(state.upgradeTargetTier);
    state.currentTier = state.upgradeTargetTier;
    if (!state.hasTariff) state.hasTariff = true;
    if (!(cost.isProrated && cost.remainingDays > 0)) setTariffPeriodFromNow();
    state.upgradeTargetTier = null;
    closeTariffQrModal();
    closePaymentModal();
    closeTariffsChoice();
    render();
    showToast('Оплата успешно выполнена');
  }

  function showToast(message) {
    const toast = getEl('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      toast.classList.add('hidden');
    }, 3000);
  }

  function openTopUpModal() {
    getEl('topUpInput').value = '';
    getEl('topUpToPay').textContent = '0 ₽';
    getEl('topUpSubmit').disabled = true;
    toggleHidden(getEl('topUpStepForm'), false);
    toggleHidden(getEl('topUpStepQr'), true);
    getEl('topUpModalTitle').textContent = 'Пополнение баланса';
    getEl('topUpModal').classList.remove('hidden');
    getEl('topUpInput').focus();
  }

  function closeTopUpModal() {
    getEl('topUpModal').classList.add('hidden');
  }

  function showTopUpQrStep(amount) {
    toggleHidden(getEl('topUpStepForm'), true);
    toggleHidden(getEl('topUpStepQr'), false);
    getEl('topUpModalTitle').textContent = 'Оплата по СБП';
  }

  function showTopUpFormStep() {
    toggleHidden(getEl('topUpStepForm'), false);
    toggleHidden(getEl('topUpStepQr'), true);
    getEl('topUpModalTitle').textContent = 'Пополнение баланса';
  }

  function getTopUpAmount() {
    const raw = getEl('topUpInput').value.trim();
    if (raw === '') return null;
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  function updateTopUpUI() {
    const amount = getTopUpAmount();
    getEl('topUpToPay').textContent = amount != null ? formatRubles(amount) : '0 ₽';
    getEl('topUpSubmit').disabled = amount == null || amount < 100;
  }

  function submitTopUp() {
    const amount = getTopUpAmount();
    if (amount == null || amount < 100) return;
    state.pendingTopUpAmount = amount;
    showTopUpQrStep(amount);
  }

  function chooseTariff(tier) {
    if (!state.hasTariff || isTariffExpired()) {
      state.upgradeTargetTier = tier;
      openPaymentModal(tier);
      closeTariffsChoice();
    } else if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(state.currentTier)) {
      openPaymentModal(tier);
    }
    render();
  }

  function openTariffsChoice() {
    if (state.hasTariff) {
      state.tariffsExpanded = true;
      toggleHidden(getEl('currentTariffExpand'), false);
      const btn = getEl('btnUpgradeTariff');
      btn.textContent = 'Скрыть тарифы';
      btn.className = 'btn btn--sm btn--secondary';
    } else {
      const view = getEl('tariffsChoiceView');
      const title = getEl('tariffsChoiceTitle');
      const hint = getEl('tariffsChoiceHint');
      if (!view || !title) return;
      view.classList.remove('hidden');
      title.textContent = 'Выберите тариф';
      toggleHidden(hint, true);
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function closeTariffsChoice() {
    getEl('tariffsChoiceView')?.classList.add('hidden');
    if (state.hasTariff) {
      state.tariffsExpanded = false;
      toggleHidden(getEl('currentTariffExpand'), true);
      const btn = getEl('btnUpgradeTariff');
      btn.textContent = 'Улучшить тариф';
      btn.className = 'btn btn--sm btn--primary';
    }
  }

  function toggleTariffsInCard() {
    state.tariffsExpanded = !state.tariffsExpanded;
    const btn = getEl('btnUpgradeTariff');
    toggleHidden(getEl('currentTariffExpand'), !state.tariffsExpanded);
    btn.textContent = state.tariffsExpanded ? 'Скрыть тарифы' : 'Улучшить тариф';
    btn.className = 'btn btn--sm ' + (state.tariffsExpanded ? 'btn--secondary' : 'btn--primary');
  }

  function render() {
    renderBalance();
    renderNoTariffBlock();
    renderCurrentTariff();
    renderTariffCards();
    var activeSelect = getEl('selectActiveTariff');
    if (activeSelect) activeSelect.value = (!state.hasTariff || isTariffExpired()) ? 'none' : state.currentTier;
  }

  function init() {
    render();

    getEl('autorenewToggle').addEventListener('change', function () {
      state.autoRenew = this.checked;
      render();
    });

    getEl('btnTopUp').addEventListener('click', openTopUpModal);
    getEl('btnTopUpNow').addEventListener('click', openTopUpModal);
    getEl('topUpModalClose').addEventListener('click', closeTopUpModal);
    getEl('topUpModal').addEventListener('click', function (e) {
      if (e.target === this) closeTopUpModal();
    });
    getEl('topUpInput').addEventListener('input', updateTopUpUI);
    getEl('topUpInput').addEventListener('change', updateTopUpUI);
    getEl('topUpSubmit').addEventListener('click', submitTopUp);
    getEl('topUpBack').addEventListener('click', showTopUpFormStep);

    getEl('btnReduceBalance').addEventListener('click', function () {
      state.balance = Math.max(0, state.balance - 2000);
      render();
    });

    getEl('selectActiveTariff').addEventListener('change', function () {
      var v = this.value;
      if (v === 'none') {
        state.hasTariff = false;
      } else {
        state.hasTariff = true;
        state.currentTier = v;
      }
      render();
    });

    getEl('selectTariffDate').addEventListener('change', function () {
      var v = this.value;
      toggleHidden(getEl('sidebarCustomDate'), v !== 'custom');
      if (v === 'custom') {
        var dateInput = getEl('inputTariffDate');
        var end = parseEndDate(state.endDate);
        dateInput.value = end ? formatDateToInput(end) : '';
        return;
      }
      var today = new Date();
      var d;
      if (v === 'none') {
        state.hasTariff = false;
      } else {
        state.hasTariff = true;
        if (v === 'default') {
          state.endDate = '28.02.2026';
          state.endTime = '23:59';
          state.paidAt = '30.01.2026 14:30';
          state.nextChargeDate = '28.02.2026';
          state.nextChargeTime = '23:59';
        } else if (v === 'expired') {
          d = new Date(today);
          d.setDate(d.getDate() - 1);
          state.endDate = formatDateDDMMYYYY(d);
          state.endTime = '23:59';
          state.nextChargeDate = state.endDate;
          state.nextChargeTime = state.endTime;
          d.setDate(d.getDate() - PERIOD_DAYS + 1);
          state.paidAt = formatDateTime(d);
        }
      }
      render();
    });

    getEl('btnApplyDate').addEventListener('click', function () {
      var raw = getEl('inputTariffDate').value.trim();
      if (!raw) return;
      var parsed = raw.indexOf('-') !== -1 ? parseInputDate(raw) : parseEndDate(raw);
      if (!parsed) return;
      state.hasTariff = true;
      state.endDate = formatDateDDMMYYYY(parsed);
      state.endTime = '23:59';
      state.nextChargeDate = state.endDate;
      state.nextChargeTime = state.endTime;
      var paid = new Date(parsed);
      paid.setDate(paid.getDate() - PERIOD_DAYS);
      state.paidAt = formatDateTime(paid);
      render();
    });

    getEl('btnChooseTariff').addEventListener('click', openTariffsChoice);
    getEl('btnUpgradeTariff').addEventListener('click', function () {
      if (state.hasTariff) toggleTariffsInCard();
      else openTariffsChoice();
    });
    getEl('tariffsChoiceBack').addEventListener('click', closeTariffsChoice);

    getEl('paymentModalClose').addEventListener('click', closePaymentModal);
    getEl('paymentModal').addEventListener('click', function (e) {
      if (e.target === this) closePaymentModal();
    });
    qsAll('.payment-method-card').forEach(function (card) {
      card.addEventListener('click', function () {
        state.paymentMethod = this.dataset.method;
        updatePaymentMethodCards();
        updatePaymentDetail();
      });
    });
    getEl('paymentBtnBalance').addEventListener('click', openConfirmBalanceModal);
    getEl('paymentBtnSbp').addEventListener('click', openTariffQrModal);

    getEl('confirmBalanceClose').addEventListener('click', closeConfirmBalanceModal);
    getEl('confirmBalanceCancel').addEventListener('click', closeConfirmBalanceModal);
    getEl('confirmBalanceConfirm').addEventListener('click', applyBalancePayment);
    getEl('confirmBalanceModal').addEventListener('click', function (e) {
      if (e.target === this) closeConfirmBalanceModal();
    });

    getEl('tariffQrClose').addEventListener('click', closeTariffQrModal);
    getEl('tariffQrBack').addEventListener('click', function () {
      closeTariffQrModal();
    });
    getEl('tariffQrDone').addEventListener('click', applyTariffAfterSbp);
    getEl('tariffQrModal').addEventListener('click', function (e) {
      if (e.target === this) closeTariffQrModal();
    });

    qsAll('.tariff-card__btn').forEach((btn) => {
      btn.addEventListener('click', function () {
        const card = this.closest('.tariff-card');
        const action = this.dataset.action;
        const tier = card?.dataset.tier;
        if (action === 'choose' || action === 'upgrade') chooseTariff(tier);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Экспорт для переключения сценариев в консоли (удобно для проверки)
  window.AdPlacerTariffs = {
    setScenario: function (key) {
      const scenarios = {
        noTariff: () => { state.hasTariff = false; state.currentTier = 'advanced'; },
        active: () => { state.hasTariff = true; state.currentTier = 'advanced'; state.autoRenew = true; state.endingSoonDays = null; state.balance = 5000; },
        autoRenew: () => { state.hasTariff = true; state.currentTier = 'advanced'; state.autoRenew = true; state.balance = 5000; },
        insufficientCoins: () => { state.hasTariff = true; state.currentTier = 'advanced'; state.autoRenew = true; state.balance = 200; },
        endingSoon: () => { state.hasTariff = true; state.currentTier = 'advanced'; state.autoRenew = true; state.endingSoonDays = 3; state.balance = 5000; }
      };
      if (scenarios[key]) { scenarios[key](); render(); }
    },
    setBalance: function (n) { state.balance = n; render(); },
    setAutoRenew: function (v) { state.autoRenew = !!v; render(); }
  };
})();
