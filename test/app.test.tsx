// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from '../src/app/App'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('visualizer app', () => {
  it('renders the simulated comparison, timeline, and cache views', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /inference scheduling, visualized/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Simulation-only/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run simulation/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /timeline step/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /performance comparison/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /queue & request states/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /paged kv cache/i })).toBeInTheDocument()
    expect(screen.getByText(/seed 42/i)).toBeInTheDocument()
  })

  it('reruns the simulation with a new seed', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/^seed/i), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }))

    expect(screen.getByText(/seed 7/i)).toBeInTheDocument()
  })

  it('supports deep links for scenario, seed, and scheduler tab', () => {
    window.history.replaceState({}, '', '/?scenario=prefix-heavy&seed=5&tab=fcfs')
    render(<App />)

    expect(screen.getByText(/seed 5/i)).toBeInTheDocument()
    expect(screen.getAllByText(/90% of requests reuse/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /fcfs \(sequential\)/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('scrubs the timeline by step', () => {
    render(<App />)

    const slider = screen.getByRole('slider', { name: /timeline step/i })
    fireEvent.change(slider, { target: { value: '1' } })

    expect(screen.getByText(/step 2 \//i)).toBeInTheDocument()
  })
})
