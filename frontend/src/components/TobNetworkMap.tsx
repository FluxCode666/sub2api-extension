import { useId } from 'react'
import { ComposableMap, Marker, useMapContext } from 'react-simple-maps'
import type { TobMapNode, TobMapSettings } from '@/lib/tob-homepage'
import networkLand from '@/assets/network-land.svg'
import './TobNetworkMap.css'

const MAP_SCALE = 185
const MAP_WORLD_WIDTH = 2 * Math.PI * MAP_SCALE

type Props = { primaryServers: TobMapNode[]; cdnLocations: TobMapNode[]; customerLocations: TobMapNode[]; settings: TobMapSettings }
type NetworkRoute = { from: TobMapNode; to: TobMapNode; kind: 'origin' | 'edge' }

function geographicDistance(from: TobMapNode, to: TobMapNode) {
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180
  const fromLatitude = from.latitude * Math.PI / 180
  const toLatitude = to.latitude * Math.PI / 180
  const haversine = Math.min(1, Math.max(0, Math.sin(latitudeDelta / 2) ** 2 + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2))
  return 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function nearestNode(node: TobMapNode, candidates: TobMapNode[]) {
  return candidates.reduce<TobMapNode | undefined>((nearest, candidate) => {
    if (!nearest) return candidate
    return geographicDistance(node, candidate) < geographicDistance(node, nearest) ? candidate : nearest
  }, undefined)
}

function curvedPath(from: [number, number], to: [number, number], curvature: number, offset = 0) {
  const startX = from[0] + offset
  const startY = from[1]
  let endX = to[0] + offset
  const endY = to[1]
  const projectedDelta = endX - startX
  if (Math.abs(projectedDelta) > MAP_WORLD_WIDTH / 2) endX += projectedDelta > 0 ? -MAP_WORLD_WIDTH : MAP_WORLD_WIDTH
  const distance = Math.hypot(endX - startX, endY - startY)
  const lift = Math.min(135, distance * (curvature / 100) * 0.72)
  const controlX = (startX + endX) / 2
  const controlY = (startY + endY) / 2 - lift
  return `M${startX.toFixed(2)},${startY.toFixed(2)} Q${controlX.toFixed(2)},${controlY.toFixed(2)} ${endX.toFixed(2)},${endY.toFixed(2)}`
}

function CurvedRoute({ route, curvature, routeStyle, flowAnimation, stroke }: { route: NetworkRoute; curvature: number; routeStyle: TobMapSettings['routeStyle']; flowAnimation: boolean; stroke: string }) {
  const { projection } = useMapContext()
  const fromCoordinates: [number, number] = [route.from.longitude, route.from.latitude]
  const toCoordinates: [number, number] = [route.to.longitude, route.to.latitude]
  const from = projection(fromCoordinates)
  const to = projection(toCoordinates)
  if (!from || !to) return null
  const paths = [0, -MAP_WORLD_WIDTH, MAP_WORLD_WIDTH].map((offset) => curvedPath(from, to, curvature, offset))
  const animateDashedRoute = flowAnimation && routeStyle === 'dashed'
  return <g className={`tob-network-route-group tob-network-route-group--${route.kind}`}>
    {paths.map((path, index) => <path
      key={`base-${index}`}
      d={path}
      className={`tob-network-route tob-network-route--${route.kind} tob-network-route--${routeStyle}${animateDashedRoute ? ' tob-network-route--flowing' : ''}`}
      stroke={stroke}
      data-testid={index === 0 ? 'network-route' : undefined}
      data-from={index === 0 ? fromCoordinates.join(',') : undefined}
      data-to={index === 0 ? toCoordinates.join(',') : undefined}
      aria-hidden="true"
    />)}
    {flowAnimation && routeStyle === 'solid' ? paths.map((path, index) => <path key={`flow-${index}`} d={path} className={`tob-network-flow tob-network-flow--${route.kind}`} stroke={stroke} aria-hidden="true" />) : null}
  </g>
}

export function TobNetworkMap({ primaryServers, cdnLocations, customerLocations, settings }: Props) {
  const gradientId = useId().replace(/:/g, '')
  const serverRoutes = cdnLocations.flatMap((cdn) => {
    const server = nearestNode(cdn, primaryServers)
    return server ? [{ from: server, to: cdn, kind: 'origin' as const }] : []
  })
  const customerRouteSources = cdnLocations.length > 0 ? cdnLocations : primaryServers
  const customerRoutes = customerLocations.flatMap((customer) => {
    const source = nearestNode(customer, customerRouteSources)
    return source ? [{ from: source, to: customer, kind: 'edge' as const }] : []
  })
  const routes = [...serverRoutes, ...customerRoutes]
  const nodeScale = settings.nodeSize / 100
  return (
    <div className="tob-network-map" data-testid="tob-network-map">
      <ComposableMap projection="geoEquirectangular" projectionConfig={{ center: [0, 0], rotate: [-150, 0, 0], scale: MAP_SCALE }} width={1200} height={600} preserveAspectRatio="xMidYMid meet" aria-label="全球服务器、CDN 与客户节点分布图">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1"><stop offset="0%" stopColor="#f59e0b" /><stop offset="100%" stopColor="#2563eb" /></linearGradient>
        </defs>
        {/* 底图离线生成；浏览器只绘制图片与可配置节点，避免阻塞首屏动画。 */}
        <image href={networkLand} width={1200} height={600} aria-hidden="true" />
        {routes.map((route, index) => <CurvedRoute key={`${route.kind}-${route.from.name}-${route.to.name}-${index}`} route={route} curvature={settings.routeCurvature} routeStyle={settings.routeStyle} flowAnimation={settings.flowAnimation} stroke={`url(#${gradientId})`} />)}
        {primaryServers.map((node, index) => <Marker key={`server-${node.name}-${node.latitude}-${index}`} coordinates={[node.longitude, node.latitude]}><title>{node.description ? `${node.name}：${node.description}` : node.name}</title><circle r={8 * nodeScale} className="tob-network-marker" fill={settings.primaryServerColor} stroke="none" /><circle r={14 * nodeScale} className="tob-network-pulse" stroke={settings.primaryServerColor} />{settings.showNodeLabels ? <text y={-16 * nodeScale} textAnchor="middle" className="tob-network-label">{node.name}</text> : null}</Marker>)}
        {cdnLocations.map((node, index) => <Marker key={`cdn-${node.name}-${node.latitude}-${index}`} coordinates={[node.longitude, node.latitude]}><title>{node.description ? `${node.name}：${node.description}` : node.name}</title><circle r={6 * nodeScale} className="tob-network-marker" fill={settings.cdnColor} stroke="none" />{settings.showNodeLabels ? <text y={-12 * nodeScale} textAnchor="middle" className="tob-network-label">{node.name}</text> : null}</Marker>)}
        {customerLocations.map((node, index) => <Marker key={`customer-${node.name}-${node.latitude}-${index}`} coordinates={[node.longitude, node.latitude]}><title>{node.description ? `${node.name}：${node.description}` : node.name}</title><circle r={5 * nodeScale} className="tob-network-marker" fill={settings.customerColor} stroke="none" />{settings.showNodeLabels ? <text y={-11 * nodeScale} textAnchor="middle" className="tob-network-label tob-network-label--customer">{node.name}</text> : null}</Marker>)}
      </ComposableMap>
    </div>
  )
}
