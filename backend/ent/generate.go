// Package ent provides the generated ORM code for the auxiliary content system.
package ent

// ent generate 入口。动态页面、发票申请与埋点 schema 均位于 ./schema。
//
// 生成命令（在 backend/ 目录下执行）：
//
//	go generate ./ent
//
// 运行生成命令后，main.go 可通过 Client 访问扩展自有 PostgreSQL 表。
//
//go:generate go run -mod=mod entgo.io/ent/cmd/ent generate ./schema
