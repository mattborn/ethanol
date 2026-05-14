const $ = id => document.getElementById(id)
const cs = prop => getComputedStyle(document.documentElement).getPropertyValue(prop).trim()
const KEY = 'ethanol_drinks'
const defaults = { beer: { abv: 10, oz: 16 }, wine: { abv: 12, oz: 5 } }
let editingId = null
let source = 'local'
let fixtureData = null
let chart = null
let currentRange = '30d'
let soberOctober = false

const getDrinks = () => {
  if (source === 'fixtures' && fixtureData) return fixtureData
  return JSON.parse(localStorage.getItem(KEY) || '[]')
}

const saveDrinks = drinks => {
  if (source === 'local') localStorage.setItem(KEY, JSON.stringify(drinks))
  render()
}

const calcEthanol = (oz, abv) => +(oz * abv / 100).toFixed(3)
const toDateStr = d => d.toISOString().split('T')[0]

const loadFixtures = async () => {
  const raw = await fetch('drinks.json').then(r => r.json())
  let id = 1700000000000
  fixtureData = raw.map(d => ({ id: id++, ...d, ethanol: calcEthanol(d.oz, d.abv) }))
}

const init = async () => {
  await loadFixtures()
  source = JSON.parse(localStorage.getItem(KEY) || '[]').length ? 'local' : 'fixtures'
  document.querySelectorAll('.source-tab').forEach(t => t.classList.toggle('active', t.dataset.source === source))
  $('reset-btn').classList.toggle('hidden', source !== 'local')
  render()
}

const addDrink = (type, oz, abv) => {
  const drinks = getDrinks()
  drinks.push({ id: Date.now(), date: toDateStr(new Date()), type, oz, abv, ethanol: calcEthanol(oz, abv) })
  saveDrinks(drinks)
}

const deleteDrink = id => saveDrinks(getDrinks().filter(d => d.id !== id))

const openEdit = id => {
  const d = getDrinks().find(d => d.id === id)
  if (!d) return
  editingId = id
  $('edit-date').value = d.date
  $('edit-type').value = d.type
  $('edit-name').value = d.name || ''
  $('edit-oz').value = d.oz
  $('edit-abv').value = d.abv
  $('edit-occasion').value = d.occasion || ''
  $('edit-modal').classList.remove('hidden')
}

const closeEdit = () => {
  editingId = null
  $('edit-modal').classList.add('hidden')
}

const saveEdit = () => {
  const drinks = getDrinks()
  const d = drinks.find(d => d.id === editingId)
  if (!d) return
  d.date = $('edit-date').value
  d.type = $('edit-type').value
  d.oz = parseFloat($('edit-oz').value)
  d.abv = parseFloat($('edit-abv').value)
  d.ethanol = calcEthanol(d.oz, d.abv)
  const name = $('edit-name').value.trim()
  const occasion = $('edit-occasion').value.trim()
  name ? d.name = name : delete d.name
  occasion ? d.occasion = occasion : delete d.occasion
  closeEdit()
  saveDrinks(drinks)
}

const dayOfYearFn = date => {
  const start = new Date(date.getFullYear(), 0, 1)
  return Math.floor((date - start) / 86400000) + 1
}

const renderChart = () => {
  const drinks = getDrinks()
  const now = new Date()
  const todayStr = toDateStr(now)
  const year = now.getFullYear()

  const rangeDays = { '7d': 7, '30d': 30, '60d': 60 }
  let minDate
  if (currentRange === 'ytd') {
    minDate = `${year}-01-01`
  } else {
    const d = new Date(now)
    d.setDate(d.getDate() - rangeDays[currentRange] + 1)
    minDate = toDateStr(d)
  }

  const dailyTotals = {}
  drinks.filter(d => d.date.startsWith(String(year))).forEach(d => {
    dailyTotals[d.date] = (dailyTotals[d.date] || 0) + d.ethanol
  })

  const sorted = Object.keys(dailyTotals).sort()
  let cumulative = 0
  const cumulativeByDate = {}
  sorted.forEach(date => {
    cumulative += dailyTotals[date]
    cumulativeByDate[date] = cumulative
  })

  let lastVal = 0
  const actualData = []
  const d = new Date(minDate + 'T00:00:00')
  const end = new Date(todayStr + 'T00:00:00')
  while (d <= end) {
    const ds = toDateStr(d)
    if (cumulativeByDate[ds] !== undefined) lastVal = cumulativeByDate[ds]
    else {
      const prior = sorted.filter(s => s < ds)
      if (prior.length) lastVal = cumulativeByDate[prior[prior.length - 1]]
    }
    actualData.push({ x: d.getTime(), y: lastVal })
    d.setDate(d.getDate() + 1)
  }

  const GREEN = cs('--status-green') + '80'
  const YELLOW = cs('--status-yellow') + '80'
  const RED = cs('--status-red') + '80'
  const paces = [
    { rate: 0.4, color: GREEN, label: '0.4 oz/day' },
    { rate: 0.5, color: YELLOW, label: '0.5 oz/day' },
    { rate: 0.6, color: RED, label: '0.6 oz/day' },
  ]
  const paceDatasets = paces.map(p => ({
    label: p.label,
    data: actualData.map(pt => ({ x: pt.x, y: dayOfYearFn(new Date(pt.x)) * p.rate })),
    borderColor: p.color,
    borderDash: [4, 4],
    borderWidth: 1.5,
    pointRadius: 0,
  }))

  const segmentColor = ctx => {
    const y = ctx.p1.parsed.y
    const day = dayOfYearFn(new Date(ctx.p1.parsed.x))
    if (y >= day * 0.6) return cs('--status-red')
    if (y >= day * 0.5) return cs('--status-yellow')
    return cs('--status-green')
  }

  const ctx = $('chart')
  if (chart) chart.destroy()
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Actual', data: actualData, borderWidth: 2, fill: false, pointRadius: 0, segment: { borderColor: segmentColor }, stepped: true },
        ...paceDatasets,
      ],
    },
    options: {
      animation: false,
      interaction: { intersect: false, mode: 'nearest' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => new Date(items[0].parsed.x).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(1)} oz`,
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          min: new Date(minDate + 'T00:00:00').getTime(),
          max: new Date(todayStr + 'T00:00:00').getTime() + 43200000,
          time: { unit: currentRange === '7d' ? 'day' : 'week' },
          grid: { color: cs('--color-lighter') },
          ticks: { color: cs('--color-half'), font: { size: 10 } },
        },
        y: {
          grid: { color: cs('--color-lighter') },
          ticks: { color: cs('--color-half'), font: { size: 10 } },
        },
      },
    },
  })
}

const render = () => {
  const drinks = getDrinks()
  const now = new Date()
  const todayStr = toDateStr(now)
  const year = now.getFullYear()
  const startOfYear = new Date(year, 0, 1)

  let ytdOz = 0
  drinks.forEach(d => { if (d.date.startsWith(String(year))) ytdOz += d.ethanol })

  const rangeOz = days => {
    const d = new Date(now)
    d.setDate(d.getDate() - days + 1)
    const min = toDateStr(d)
    return drinks.reduce((sum, d) => d.date >= min && d.date <= todayStr ? sum + d.ethanol : sum, 0)
  }
  $('oz-7d').textContent = rangeOz(7).toFixed(1) + ' oz'
  $('oz-30d').textContent = rangeOz(30).toFixed(1) + ' oz'
  $('oz-60d').textContent = rangeOz(60).toFixed(1) + ' oz'
  $('oz-ytd').textContent = ytdOz.toFixed(1) + ' oz'

  const soberDays = soberOctober ? 30 : 0
  const dayOfYear = Math.floor((now - startOfYear) / 86400000) + 1 + soberDays
  const daysInYear = (((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365) + soberDays
  const dailyAvg = dayOfYear > 0 ? ytdOz / dayOfYear : 0
  const projectedOz = dailyAvg * daysInYear

  $('projected-oz').textContent = projectedOz.toFixed(1)
  $('projected-drinks').textContent = (projectedOz / 0.6).toFixed(0)
  const liters = projectedOz * 0.0295735
  const litersEl = $('projected-liters')
  litersEl.textContent = liters.toFixed(2) + (liters < 6.5 ? ' ✓' : '')
  litersEl.classList.toggle('under', liters < 6.5)
  litersEl.classList.toggle('over', liters >= 6.5)

  $('pace-oz').textContent = dailyAvg.toFixed(3)
  const pace = $('pace')
  const ps = $('pace-status')
  pace.classList.remove('pace-green', 'pace-yellow', 'pace-red')
  if (dailyAvg < 0.5) { pace.classList.add('pace-green'); ps.textContent = 'under pace' }
  else if (dailyAvg < 0.6) { pace.classList.add('pace-yellow'); ps.textContent = 'on pace' }
  else { pace.classList.add('pace-red'); ps.textContent = 'over pace' }

  const drinkTypes = [
    { label: 'beers', ethanol: 1.2 },
    { label: 'joeys', ethanol: 1 },
  ]
  const thresholds = [
    { rate: 0.4, label: 'below target', color: 'var(--status-green)', dot: 'dot-green' },
    { rate: 0.5, label: 'below pace', color: 'var(--status-yellow)', dot: 'dot-yellow' },
    { rate: 0.6, label: 'below max', color: 'var(--status-red)', dot: 'dot-red' },
  ]
  const outlook = $('outlook')
  outlook.replaceChildren()
  const active = thresholds
    .map(t => ({ ...t, headroom: Math.max(0, dayOfYear * t.rate - ytdOz) }))
    .filter(t => t.rate >= 0.5)
  if (active.length) {
    const card = document.createElement('div')
    card.className = 'card'
    const section = document.createElement('div')
    section.className = 'card-header'
    const grid = document.createElement('div')
    grid.className = 'row outlook-grid'

    const titleCol = document.createElement('div')
    titleCol.className = 'outlook-col'
    titleCol.appendChild(Object.assign(document.createElement('p'), { textContent: 'Outlook' }))
    grid.appendChild(titleCol)

    active.forEach(t => {
      const col = document.createElement('div')
      col.className = 'stack fill'
      const label = document.createElement('p')
      label.appendChild(document.createTextNode(t.label))
      const dot = document.createElement('span')
      dot.className = `outlook-dot ${t.dot}`
      label.appendChild(dot)
      col.appendChild(label)
      const stats = document.createElement('div')
      stats.className = 'row'
      drinkTypes.forEach(d => {
        const n = Math.floor(t.headroom / d.ethanol)
        const stat = document.createElement('div')
        stat.className = 'stat fill'
        const val = document.createElement('div')
        val.className = 'stat-value'
        val.textContent = n
        const desc = document.createElement('div')
        desc.className = 'stat-label'
        desc.textContent = d.label
        stat.appendChild(val)
        stat.appendChild(desc)
        stats.appendChild(stat)
      })
      col.appendChild(stats)
      grid.appendChild(col)
    })

    section.appendChild(grid)
    card.appendChild(section)
    outlook.appendChild(card)
  }

  const sorted = [...drinks].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const hist = $('history')
  hist.replaceChildren()
  let lastDate = ''
  sorted.forEach(d => {
    if (d.date !== lastDate) {
      lastDate = d.date
      const occasion = sorted.find(x => x.date === d.date && x.occasion)?.occasion
      const header = document.createElement('div')
      header.className = 'date-header'
      header.textContent = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + (occasion ? ` — ${occasion}` : '')
      hist.appendChild(header)
    }
    const item = document.createElement('div')
    item.className = 'history-item'
    item.addEventListener('click', () => openEdit(d.id))
    const info = document.createElement('div')
    info.className = 'history-info fill'
    info.textContent = `${d.name || d.type} — ${d.oz} oz @ ${d.abv}%`
    const oz = document.createElement('div')
    oz.className = 'history-oz'
    oz.textContent = d.ethanol.toFixed(2)
    item.appendChild(info)
    item.appendChild(oz)
    hist.appendChild(item)
  })
  renderChart()
}

// Event listeners
const showBeerPresets = () => {
  $('drink-bar').classList.add('hidden')
  $('beer-bar').classList.remove('hidden')
}

const resetDrinkBar = () => {
  $('beer-bar').classList.add('hidden')
  $('drink-bar').classList.remove('hidden')
}

const addBeerPreset = (name, oz, abv) => {
  const d = getDrinks()
  d.push({ id: Date.now(), date: toDateStr(new Date()), type: 'Beer', name, oz, abv, ethanol: calcEthanol(oz, abv) })
  saveDrinks(d)
  resetDrinkBar()
}

$('add-beer').addEventListener('click', showBeerPresets)
$('add-fuki').addEventListener('click', () => addBeerPreset('Fukiphino', 16, 9))
$('add-ferda').addEventListener('click', () => addBeerPreset('Ferda IPA', 16, 8.2))
$('add-2x4').addEventListener('click', () => addBeerPreset('Melvin 2x4', 12, 9.9))
$('add-cocktail').addEventListener('click', () => addDrink('Cocktail', 2.5, 40))

document.addEventListener('click', e => {
  if (!e.target.closest('#beer-bar') && !e.target.closest('#add-beer')) resetDrinkBar()
})

$('legend-toggle').addEventListener('click', () => {
  const legend = $('legend')
  const isHidden = legend.classList.toggle('hidden')
  $('legend-toggle').textContent = isHidden ? 'Show legend' : 'Hide legend'
})

document.querySelectorAll('#legend [data-pace]').forEach(el => {
  const i = parseInt(el.dataset.pace)
  el.addEventListener('mouseenter', () => {
    if (!chart) return
    const ds = chart.data.datasets[i]
    ds._origWidth = ds.borderWidth
    ds._origColor = ds.borderColor
    ds.borderWidth = 4
    ds.borderColor = ds.borderColor.replace('80', 'ff')
    chart.update('none')
  })
  el.addEventListener('mouseleave', () => {
    if (!chart) return
    const ds = chart.data.datasets[i]
    ds.borderWidth = ds._origWidth
    ds.borderColor = ds._origColor
    chart.update('none')
  })
})

$('sober-toggle').addEventListener('click', () => {
  soberOctober = !soberOctober
  $('sober-toggle').setAttribute('aria-checked', soberOctober)
  render()
})
$('add-wine').addEventListener('click', () => addDrink('Wine', defaults.wine.oz, defaults.wine.abv))
$('reset-btn').addEventListener('click', () => {
  if (!confirm('Reset local storage from fixtures?')) return
  if (fixtureData) localStorage.setItem(KEY, JSON.stringify(fixtureData))
  render()
})
$('edit-delete').addEventListener('click', () => {
  if (!confirm('Delete this drink?')) return
  const id = editingId
  closeEdit()
  deleteDrink(id)
})
$('edit-cancel').addEventListener('click', closeEdit)
$('edit-save').addEventListener('click', saveEdit)
$('edit-modal').addEventListener('click', e => { if (e.target === $('edit-modal')) closeEdit() })

document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentRange = btn.dataset.range
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    renderChart()
  })
})

document.querySelectorAll('.source-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    source = tab.dataset.source
    document.querySelectorAll('.source-tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    $('reset-btn').classList.toggle('hidden', source !== 'local')
    render()
  })
})

const setMode = mode => {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', mode)
  localStorage.theme = mode
  const isDark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  $('mode').textContent = isDark ? '☀️' : '🌙'
}

$('mode').addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
  setMode(isDark ? 'light' : 'dark')
})

setMode(localStorage.theme || 'system')
init()
