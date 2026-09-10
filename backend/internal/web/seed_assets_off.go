//go:build !embed

package web

// SeedClientAssets 在非 embed 构建中为 no-op：
// 源码/本地开发构建的资源直接位于 assets.dir(默认 backend/data/assets) 下，无需种子。
func SeedClientAssets(assetDir string) error {
	return nil
}
