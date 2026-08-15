// Package ent provides the generated ORM code for the auxiliary content system.
package ent

// ent generate 入口。后续单元（U5）会在 ./schema 下追加 page_view/feature_click 等 schema。
//
// 生成命令（在 backend/ 目录下执行）：
//
//	go generate ./ent
//
// 当前无具体 schema：ent generate 仍会产出可初始化的 Client 框架（空 schema 集合），
// 保证 main.go 能 NewClient 并连接 PostgreSQL。
//
//go:generate go run -mod=mod entgo.io/ent/cmd/ent generate ./schema
