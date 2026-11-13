import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'

import { LookmlPreviewPane, parseLookmlFileDisplay } from '../../lookmlTool'

export function registerPermissionsPart17Tests(): void {
  test('77. Issue #189: parses LookML file stems/dirs/kind letters (E/V/T/D/M/R/F) via parseLookmlFileDisplay and renders compact badges, file-opener trigger, and project-root fallback when files is empty', () => {
    expect(parseLookmlFileDisplay('bronze/explores/order_items_base.explore.lkml')).toEqual({
      stem: 'order_items_base',
      dir: 'bronze/explores',
      fullPath: 'bronze/explores/order_items_base.explore.lkml',
      letter: 'E',
    })
    expect(parseLookmlFileDisplay('bronze/distribution_centers.view.lkml')).toEqual({
      stem: 'distribution_centers',
      dir: 'bronze',
      fullPath: 'bronze/distribution_centers.view.lkml',
      letter: 'V',
    })
    expect(parseLookmlFileDisplay('tests/bronze/orders.test.lkml')).toEqual({
      stem: 'orders',
      dir: 'tests/bronze',
      fullPath: 'tests/bronze/orders.test.lkml',
      letter: 'T',
    })
    expect(parseLookmlFileDisplay('dashboards/exec_pulse.dashboard.lookml')).toEqual({
      stem: 'exec_pulse',
      dir: 'dashboards',
      fullPath: 'dashboards/exec_pulse.dashboard.lookml',
      letter: 'D',
    })
    expect(parseLookmlFileDisplay('bryan_test2.model.lkml')).toEqual({
      stem: 'bryan_test2',
      dir: '',
      fullPath: 'bryan_test2.model.lkml',
      letter: 'M',
    })
    expect(parseLookmlFileDisplay('silver/orders.refinement.lkml')).toEqual({
      stem: 'orders',
      dir: 'silver',
      fullPath: 'silver/orders.refinement.lkml',
      letter: 'R',
    })
    expect(parseLookmlFileDisplay('manifest.lkml')).toEqual({
      stem: 'manifest',
      dir: '',
      fullPath: 'manifest.lkml',
      letter: 'F',
    })
    expect(parseLookmlFileDisplay('security/access_grants.lookml')).toEqual({
      stem: 'access_grants',
      dir: 'security',
      fullPath: 'security/access_grants.lookml',
      letter: 'F',
    })
    expect(parseLookmlFileDisplay('  MODELS/MY.CUSTOM.SALES.MODEL.LKML  ')).toEqual({
      stem: 'MY.CUSTOM.SALES',
      dir: 'MODELS',
      fullPath: 'MODELS/MY.CUSTOM.SALES.MODEL.LKML',
      letter: 'M',
    })
    expect(parseLookmlFileDisplay('/bronze/orders.view.lkml')).toEqual({
      stem: 'orders',
      dir: 'bronze',
      fullPath: '/bronze/orders.view.lkml',
      letter: 'V',
    })
    expect(parseLookmlFileDisplay('//manifest.lkml')).toEqual({
      stem: 'manifest',
      dir: '',
      fullPath: '//manifest.lkml',
      letter: 'F',
    })
    expect(parseLookmlFileDisplay('apps/current/app.js')).toEqual({
      stem: 'app.js',
      dir: 'apps/current',
      fullPath: 'apps/current/app.js',
      letter: null,
    })
    expect(parseLookmlFileDisplay('kda_report.md')).toEqual({
      stem: 'kda_report.md',
      dir: '',
      fullPath: 'kda_report.md',
      letter: null,
    })
    expect(parseLookmlFileDisplay('')).toEqual({
      stem: '',
      dir: '',
      fullPath: '',
      letter: null,
    })
    expect(parseLookmlFileDisplay('.lkml')).toEqual({
      stem: '.lkml',
      dir: '',
      fullPath: '.lkml',
      letter: null,
    })
    expect(parseLookmlFileDisplay('bronze/.lkml')).toEqual({
      stem: '.lkml',
      dir: 'bronze',
      fullPath: 'bronze/.lkml',
      letter: null,
    })

    const emptyFilesWithProjHtml = renderToStaticMarkup(
      React.createElement(LookmlPreviewPane, {
        bundle: { id: 'b_empty', title: 'Sales Core', project_id: 'sales_core', files: [] },
        hostUrl: 'https://dev.looker.com',
      })
    )
    expect(emptyFilesWithProjHtml).not.toContain('data-testid="lookml-file-picker-btn"')
    expect(emptyFilesWithProjHtml).toContain('data-testid="lookml-toolbar-open-ide-btn"')
  })

}
