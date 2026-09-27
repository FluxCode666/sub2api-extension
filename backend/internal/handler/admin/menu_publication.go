package admin

import "context"

// menuPublishAvailability 由 Sub2API 菜单存储实现：数据库与扩展公网地址都就绪时才能上架菜单。
type menuPublishAvailability interface {
	MenuPublishAvailable(ctx context.Context) bool
}

// menuPublicationInfo 描述管理端展示用的扩展公网地址生效情况。
type menuPublicationInfo interface {
	menuPublishAvailability
	EffectivePublicURL(ctx context.Context) (string, string)
}

// menuPublishAvailable 判断 publisher 当前能否真正写入 Sub2API 菜单；
// 未实现可用性探测的测试替身视为可用。
func menuPublishAvailable(ctx context.Context, publisher any) bool {
	if publisher == nil {
		return false
	}
	if availability, ok := publisher.(menuPublishAvailability); ok {
		return availability.MenuPublishAvailable(ctx)
	}
	return true
}
