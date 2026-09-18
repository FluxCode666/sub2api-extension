import type { PropsWithChildren, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DEFAULT_TOB_MAP_SETTINGS } from '@/lib/tob-homepage'
import { TobNetworkMap } from './TobNetworkMap'

vi.mock('react-simple-maps', () => ({
  ComposableMap: ({ children, projection, projectionConfig, width, height }: PropsWithChildren<{ projection: string; projectionConfig: { center: number[]; rotate: number[]; scale: number }; width: number; height: number }>) => <svg data-testid="world-map-svg" data-projection={projection} data-center={projectionConfig.center.join(',')} data-rotate={projectionConfig.rotate.join(',')} data-scale={projectionConfig.scale} viewBox={`0 0 ${width} ${height}`}>{children}</svg>,
  Geographies: ({ children }: { children: (value: { geographies: never[] }) => ReactNode }) => <g>{children({ geographies: [] })}</g>,
  Geography: () => null,
  Marker: ({ children }: PropsWithChildren) => <g>{children}</g>,
  useMapContext: () => ({ projection: ([longitude, latitude]: [number, number]) => [longitude, latitude] }),
}))

const defaultProps = {
  primaryServers: [],
  cdnLocations: [],
  customerLocations: [],
  settings: DEFAULT_TOB_MAP_SETTINGS,
}

describe('TobNetworkMap', () => {
  it('uses a full-world projection with the Americas on the right', () => {
    render(<TobNetworkMap {...defaultProps} />)

    const map = screen.getByTestId('world-map-svg')
    expect(map).toHaveAttribute('data-projection', 'geoEquirectangular')
    expect(map).toHaveAttribute('data-center', '0,0')
    expect(map).toHaveAttribute('data-rotate', '-150,0,0')
    expect(map).toHaveAttribute('data-scale', '185')
    expect(map).toHaveAttribute('viewBox', '0 0 1200 600')
  })

  it('connects each CDN to its nearest server and each customer to its nearest CDN', () => {
    render(<TobNetworkMap
      primaryServers={[
        { name: '上海主站', latitude: 31.23, longitude: 121.47 },
        { name: '法兰克福主站', latitude: 50.11, longitude: 8.68 },
      ]}
      cdnLocations={[
        { name: '东京 CDN', latitude: 35.68, longitude: 139.69 },
        { name: '巴黎 CDN', latitude: 48.86, longitude: 2.35 },
      ]}
      customerLocations={[
        { name: '新加坡客户', latitude: 1.35, longitude: 103.82 },
        { name: '伦敦客户', latitude: 51.51, longitude: -0.13 },
      ]}
      settings={DEFAULT_TOB_MAP_SETTINGS}
    />)

    const routes = screen.getAllByTestId('network-route')
    expect(routes).toHaveLength(4)
    expect(routes.map((route) => [route.getAttribute('data-from'), route.getAttribute('data-to')])).toEqual([
      ['121.47,31.23', '139.69,35.68'],
      ['8.68,50.11', '2.35,48.86'],
      ['139.69,35.68', '103.82,1.35'],
      ['2.35,48.86', '-0.13,51.51'],
    ])
  })

  it('connects customers directly to the nearest server when no CDN is configured', () => {
    render(<TobNetworkMap
      primaryServers={[{ name: '上海主站', latitude: 31.23, longitude: 121.47 }]}
      cdnLocations={[]}
      customerLocations={[{ name: '新加坡客户', latitude: 1.35, longitude: 103.82 }]}
      settings={DEFAULT_TOB_MAP_SETTINGS}
    />)

    const route = screen.getByTestId('network-route')
    expect(route).toHaveAttribute('data-from', '121.47,31.23')
    expect(route).toHaveAttribute('data-to', '103.82,1.35')
  })

  it('applies labels, curvature, node size, colors, line style and flow settings', () => {
    const { container } = render(<TobNetworkMap
      primaryServers={[{ name: '上海主站', latitude: 20, longitude: 10 }]}
      cdnLocations={[{ name: '东京 CDN', latitude: 40, longitude: 30 }]}
      customerLocations={[]}
      settings={{
        ...DEFAULT_TOB_MAP_SETTINGS,
        showNodeLabels: false,
        routeCurvature: 50,
        nodeSize: 150,
        primaryServerColor: '#112233',
        cdnColor: '#445566',
        customerColor: '#778899',
        routeStyle: 'solid',
        flowAnimation: false,
      }}
    />)

    const route = screen.getByTestId('network-route')
    expect(route).toHaveClass('tob-network-route--solid')
    expect(route.getAttribute('d')).toMatch(/^M10\.00,20\.00 Q20\.00,19\.82 30\.00,40\.00$/)
    expect(container.querySelector('.tob-network-flow')).not.toBeInTheDocument()
    expect(container.querySelector('text')).not.toBeInTheDocument()
    expect(container.querySelector('circle[fill="#112233"]')).toHaveAttribute('r', '12')
    expect(container.querySelector('circle[fill="#112233"]')).toHaveAttribute('stroke', 'none')
    expect(container.querySelector('circle[fill="#445566"]')).toHaveAttribute('r', '9')
    expect(container.querySelector('.tob-network-legend')).not.toBeInTheDocument()
  })

  it('animates the dashed route itself without rendering a separate flow overlay', () => {
    const { container } = render(<TobNetworkMap
      primaryServers={[{ name: '主站', latitude: 0, longitude: 0 }]}
      cdnLocations={[{ name: '边缘', latitude: 10, longitude: 10 }]}
      customerLocations={[]}
      settings={{ ...DEFAULT_TOB_MAP_SETTINGS, routeStyle: 'dashed', flowAnimation: true }}
    />)

    expect(screen.getByTestId('network-route')).toHaveClass('tob-network-route--dashed', 'tob-network-route--flowing')
    expect(container.querySelector('.tob-network-flow')).not.toBeInTheDocument()
  })

  it('keeps the flowing overlay for solid routes', () => {
    const { container } = render(<TobNetworkMap
      primaryServers={[{ name: '主站', latitude: 0, longitude: 0 }]}
      cdnLocations={[{ name: '边缘', latitude: 10, longitude: 10 }]}
      customerLocations={[]}
      settings={{ ...DEFAULT_TOB_MAP_SETTINGS, routeStyle: 'solid', flowAnimation: true }}
    />)

    expect(screen.getByTestId('network-route')).toHaveClass('tob-network-route--solid')
    expect(screen.getByTestId('network-route')).not.toHaveClass('tob-network-route--flowing')
    expect(container.querySelectorAll('.tob-network-flow')).toHaveLength(3)
  })
})
