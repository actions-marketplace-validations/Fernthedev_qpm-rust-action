import {
  getActionParameters,
  getReleaseDownloadLink,
  githubExecAsync
} from './utils'

import * as core from '@actions/core'
import * as github from '@actions/github'
import {GitHub} from '@actions/github/lib/utils'
import {QPMSharedPackage, readQPM, writeQPM} from './qpmf'
import {QPM_COMMAND_PUBLISH} from './const'

async function doPublish(
  octokit: InstanceType<typeof GitHub>,
  release: boolean,
  debug: boolean,
  qmod?: string,
  version?: string
): Promise<void> {
  core.info("Publishing")
  const qpmSharedPath = 'qpm.shared.json'
  // path.join(
  //   // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  //   process.env.GITHUB_WORKSPACE!,
  //   'qpm.shared.json'
  // )
  const qpmFile = await readQPM<QPMSharedPackage>(qpmSharedPath)

  if (version) {
    qpmFile.config.info.version = version
  }
  version ??= qpmFile.config.info.version

  const branch = `version-${version}`
  qpmFile.config.info.additionalData.branchName = branch

  const additionalData = qpmFile.config.info.additionalData

  const download = getReleaseDownloadLink(
    github.context.repo.owner,
    github.context.repo.repo,
    version
  )

  if (release) {
    const name =
      additionalData.overrideSoName ??
      `lib${qpmFile.config.info.id}_${qpmFile.config.info.version.replace(
        '.',
        '_'
      )}.so`
    qpmFile.config.info.additionalData.soLink = `${download}/${name}`
  }

  if (debug) {
    const name =
      additionalData.debugSoLink ??
      `debug_lib${qpmFile.config.info.id}_${qpmFile.config.info.version.replace(
        '.',
        '_'
      )}.so`
    qpmFile.config.info.additionalData.soLink = `${download}/${name}`
  }

  if (qmod) {
    qpmFile.config.info.additionalData.modLink = `${download}/${qmod}`
  }

  await writeQPM(qpmSharedPath, qpmFile)

  const git = octokit.rest.git

  const lastCommitSha = github.context.sha
  const lastCommit = await git.getCommit({
    ...github.context.repo,
    commit_sha: lastCommitSha
  })

  // create commit
  // const blob = await git.createBlob({
  //   ...github.context.repo,
  //   content: JSON.stringify(qpmFile)
  // })
  const blobTree = await git.createTree({
    ...github.context.repo,
    tree: [
      {
        content: JSON.stringify(qpmFile),
        path: qpmSharedPath
      }
    ],
    base_tree: lastCommit.data.tree.sha
  })
  const commit = await git.createCommit({
    ...github.context.repo,
    parents: [lastCommitSha],
    message: 'Update version and post restore',
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    tree: blobTree.data.tree[0].sha!!
  })

  git.updateRef({
    ...github.context.repo,
    ref: github.context.ref,
    sha: commit.data.sha
  })

  // create tag
  const tag = await git.createTag({
    ...github.context.repo,
    tag: version,
    message: 'Version',
    object: commit.data.sha,
    type: 'commit'
  })

  const tagRef = `refs/tags/${version}`

  try {
    await git.deleteRef({
      ...github.context.repo,
      ref: tagRef
    })
  } catch (e) {
    core.warning(`Deleting existing tag failed due to ${e}`)
  }

  await git.createRef({
    ...github.context.repo,
    ref: tagRef,
    sha: tag.data.sha
  })

  // create branch
  // reference https://github.com/peterjgrainger/action-create-branch/blob/c2800a3a9edbba2218da6861fa46496cf8f3195a/src/create-branch.ts#L3
  const ref = `refs/heads/${branch}`

  try {
    await git.deleteRef({
      ...github.context.repo,
      ref
    })
  } catch (e) {
    core.warning(`Deleting existing branch failed due to ${e}`)
  }

  await git.createRef({
    ...github.context.repo,
    ref,
    sha: commit.data.sha
  })

  // do github stuff
}

export async function publishRun(params: ReturnType<typeof getActionParameters>): Promise<void> {
  const {
    token,
    qpmDebugBin,
    qpmQmod,
    qpmReleaseBin,
    version,
    publishToken
  } = params

  const octokit = github.getOctokit(token)

  await doPublish(octokit, qpmReleaseBin, qpmDebugBin, qpmQmod, version)

  if (publishToken) {
    githubExecAsync(`qpm-rust ${QPM_COMMAND_PUBLISH} --token ${publishToken}`)
  } else {
    githubExecAsync(`qpm-rust ${QPM_COMMAND_PUBLISH}`)
  }
}