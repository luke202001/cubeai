import {Component, OnInit, OnDestroy, ViewChild} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {MatDialog, MatPaginator, PageEvent} from '@angular/material';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs/Subscription';
import {Principal, ConfirmService, SnackBarService, GlobalService, UaaClient, ITEMS_PER_PAGE, PAGE_SIZE_OPTIONS} from '../../shared';
import {UmmClient, UmuClient} from '../';
import {Solution} from '../model/solution.model';
import {Artifact} from '../model/artifact.model';
import {Document} from '../model/document.model';
import {Ability} from '../model/ability.model';
import { saveAs } from 'file-saver';
import {FileUploader} from 'ng2-file-upload';
import {SERVER_API_URL} from '../../app.constants';
import {FileItem} from 'ng2-file-upload/file-upload/file-item.class';
import {PictureSelectComponent} from './picture-select.component';
import {Star} from '../model/star.model';
import {Description} from '../model/description.model';
import {Comment} from '../model/comment.model';
import {v4 as uuid} from 'uuid';

@Component({
    templateUrl: './solution.component.html',
    styleUrls: [
        './solution.css',
    ],
})
export class SolutionComponent implements OnInit, OnDestroy {
    isMobile = window.screen.width < 960;

    userLogin: string;
    subscription: Subscription;
    solutionUuid: string;
    isEditing = false;
    isOwner = false;
    isManager = false;
    isOperator = false;
    readyToDelete = false;
    deleteConfirmText: string;
    openAbilityUrl: string;
    deployedAbility: Ability;
    solution: Solution = null;
    description: Description = new Description();
    ymlText: string;
    artifacts: Artifact[];
    documents: Document[];
    uploader: FileUploader;
    star: Star;
    comments: Comment[] = [];
    commentText: string;

    // 用于Comment的分页显示
    @ViewChild(MatPaginator) paginator: MatPaginator;
    pageSizeOptions = PAGE_SIZE_OPTIONS;
    itemsPerPage = ITEMS_PER_PAGE;
    previousItemsPerPage = ITEMS_PER_PAGE;
    totalItems: number;
    page = 1;
    previousPage = 1;

    constructor(
        private globalService: GlobalService,
        private dialog: MatDialog,
        private route: ActivatedRoute,
        private router: Router,
        private principal: Principal,
        private location: Location,
        private uaaClient: UaaClient,
        private ummClient: UmmClient,
        private umuClient: UmuClient,
        private snackBarService: SnackBarService,
        private confirmService: ConfirmService,
    ) {
    }

    goBack() {
        this.location.back();
    }

    ngOnDestroy() {
        this.subscription.unsubscribe();
    }

    ngOnInit() {
        this.subscription = this.route.params.subscribe((params) => {
            this.solutionUuid = params['solutionUuid'];
        });

        this.principal.updateCurrentAccount().then(() => {
            this.userLogin = this.principal.getLogin();
            this.isManager = this.principal.hasAuthority('ROLE_MANAGER');
            this.isOperator = this.principal.hasAuthority('ROLE_OPERATOR');
            this.loadAll();
        });
    }

    loadAll() {
        this.ummClient.get_solutions({
            uuid: this.solutionUuid,
        }).subscribe(
            (res) => {
                if (res.body['status'] === 'ok') {
                    if (res.body['value']['total'] < 1) {
                        this.snackBarService.error('模型不存在！');
                        this.solution = null;
                        return;
                    }

                    this.solution = res.body['value']['results'][0];
                    this.isOwner = this.userLogin === this.solution.authorLogin;

                    if (!this.solution.active && !this.isOwner && !this.isManager) {
                        this.snackBarService.error('模型已被作者设为私有，无法继续访问！');
                        this.solution = null;
                        return;
                    }

                    if (!this.solution.pictureUrl) {
                        this.uaaClient.get_random_picture({
                            width: 200,
                            height: 200,
                        }).subscribe(
                            (res1) => {
                                if (res1.body['status'] === 'ok') {
                                    this.solution.pictureUrl = res1.body['value'];
                                    this.ummClient.update_solution_picture_url({
                                        solutionId: this.solution.id,
                                        pictureUrl: this.solution.pictureUrl,
                                    }).subscribe();
                                }
                            }
                        );
                    }

                    this.ummClient.update_solution_view_count({
                        solutionId: this.solution.id,
                    }).subscribe();
                    this.solution.viewCount ++;

                    this.ummClient.get_deployments({
                        isPublic: this.solution.active,
                        solutionUuid: this.solutionUuid,
                        status: '运行',
                    }).subscribe(
                        (res4) => {
                            if (res4.body['status'] === 'ok' && res4.body['value']['total'] > 0) {
                                this.deployedAbility = res4.body['value']['results'][0];
                                this.openAbilityUrl = '/popen/#/ability/' + res4.body['value']['results'][0].uuid;
                            }
                        }
                    );

                    this.loadDescription();
                    this.loadArtifactData();
                    this.loadDocumentData();
                    this.loadStar();
                    this.loadComments();

                    this.uploader = new FileUploader({
                        url: SERVER_API_URL + 'umu/api/file/upload_document/' + this.solution.uuid,
                        method: 'POST',
                        itemAlias: 'upload_document',
                    });
                } else {
                    this.snackBarService.error('获取模型数据失败！');
                    this.solution = null;
                    return;
                }
            }, () => {
                this.snackBarService.error('获取模型数据失败！');
                this.solution = null;
                return;
            }
        );
    }

    canEdit(): boolean {
        return this.isOwner || this.isManager;
    }

    upload(fileItem: FileItem) {
        fileItem.onSuccess = () => {
            this.loadDocumentData();
        };

        fileItem.onError = () => {
            this.loadDocumentData();
        };

        if (fileItem.file.size > 20 * 1024 * 1024) {
            this.snackBarService.error('上传文档不能大于20MB！');
            fileItem.remove();
            return;
        }

        if (this.documents.length > 4) {
            this.snackBarService.error('一个模型最多5个文档！请删除现有文档后再上传新文档...');
            return;
        }

        if (this.findExistDocument(fileItem.file.name)) {
            this.snackBarService.error('本模型中已存在同名文档！请删除现有文档后再上传新文档...');
        } else {
            fileItem.upload();
        }
    }

    findExistDocument(fileName: string): boolean {
        for (let i = 0; i < this.documents.length; i++) {
            if (this.documents[i].name === fileName) {
                return true;
            }
        }
        return false;
    }

    loadDescription() {
        this.ummClient.find_description({
            solutionUuid: this.solution.uuid,
        }).subscribe(
            (res) => {
                if (res.body['status'] === 'ok') {
                    this.description = res.body['value'];
                }
            }
        );
    }

    loadArtifactData() {
        this.ummClient.get_artifacts({
            solutionUuid: this.solution.uuid,
        }).subscribe(
            (res) => {
                if (res.body['status'] === 'ok') {
                    this.artifacts = res.body['value'];
                    this.artifacts.forEach((artifact) => {
                        if (artifact.type === '模型配置') {
                            this.umuClient.download_document({
                                url: artifact.url,
                            }).subscribe(
                                (res1) => {
                                    if (res1.body['status'] === 'ok') {
                                        this.ymlText = res1.body['value'];
                                    }
                                }
                            );
                        }
                    });
                }
            }
        );
    }

    loadDocumentData() {
        this.ummClient.get_documents({
            solutionUuid: this.solution.uuid,
        }).subscribe(
            (res) => {
                if (res.body['status'] === 'ok') {
                    this.documents = res.body['value'];
                }
            }
        );
    }

    loadStar() {
        if (this.userLogin) {
            this.ummClient.get_stars({
                userLogin: this.userLogin,
                targetUuid: this.solutionUuid,
            }).subscribe(
                (res) => {
                    if (res.body['status'] === 'ok') {
                        if (res.body['value']['total'] > 0) {
                            this.star = res.body['value']['results'][0];
                        } else {
                            this.star = null;
                        }
                    }
                }
            );
        }

    }

    isTextFile(url: string): boolean {
       const ext = url.substring(url.lastIndexOf('.') + 1);
       return ext === 'json' || ext === 'proto' || ext === 'txt';
    }

    // 将超链接地址隐藏在程序中，不在html中暴露。但实际上在浏览器中还是可以获得该地址的。
    downloadFile(url: string) {
        const link: HTMLElement = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', '');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.ummClient.update_solution_download_count({
            solutionId: this.solution.id,
        }).subscribe();
    }

    deleteDocument(document: Document) {
        this.confirmService.ask('确定要删除该文档？').then((confirm) => {
            if (confirm) {
                this.umuClient.delete_document({
                    documentId: document.id,
                }).subscribe(
                    () => {
                        this.loadDocumentData();
                    }
                );
            }
        });
    }

    copyDockerUrl(dockerUrl: string) {
        const oInput = document.createElement('input');
        oInput.value = 'docker run ' + dockerUrl;
        document.body.appendChild(oInput);
        oInput.select();
        document.execCommand('Copy'); // 执行浏览器复制命令
        oInput.className = 'oInput';
        oInput.style.display = 'none';
        this.snackBarService.info('拉取并运行docker镜像的命令已复制到剪贴板...');

        this.ummClient.update_solution_download_count({
            solutionId: this.solution.id,
        }).subscribe();
    }

    enterEdit() {
        this.isEditing = true;
    }

    saveAndQuitEdit() {
        this.ummClient.update_solution_baseinfo({
            solutionId: this.solution.id,
            name: this.solution.name,
            company: this.solution.company,
            version: this.solution.version,
            summary: this.solution.summary,
            tag1: this.solution.tag1,
            tag2: this.solution.tag2,
            tag3: this.solution.tag3,
            modelType: this.solution.modelType,
            toolkitType: this.solution.toolkitType,
        }).subscribe((res) => {
            if (res.body['status'] === 'ok') {
                if (this.isManager) {
                    this.ummClient.update_solution_admininfo({
                        solutionId: this.solution.id,
                        subject1: this.solution.subject1,
                        subject2: this.solution.subject2,
                        subject3: this.solution.subject3,
                        displayOrder: this.solution.displayOrder,
                    }).subscribe();
                }

                this.ummClient.update_deployment_solution_info({
                    deploymentId: this.deployedAbility.id,
                }).subscribe();
            }
        });

        this.ummClient.update_description({
            descriptionId: this.description.id,
            content: this.description.content,
        }).subscribe();

        this.isEditing = false;
    }

    setSolutionPublic(isPublic: boolean) {
        if (!isPublic) {
            this.ummClient.get_my_credit({}).subscribe((res) => {
                if (res.body['status'] === 'ok') {
                    const credit = res.body['value'].credit;
                    if (credit < 20) {
                        this.snackBarService.error('模型设为私有需要消耗20积分，你目前仅有' + credit + '积分，无法操作！');
                        return;
                    } else {
                        this.confirmService.ask('模型设为私有将消耗20积分，你现有' + credit + '积分，是否继续？').then((confirm) => {
                            if (confirm) {
                                this.solution.active = isPublic;
                                this.ummClient.update_solution_active({
                                    solutionId: this.solution.id,
                                    active: isPublic,
                                }).subscribe();
                            }
                        });
                    }
                }

            });
        } else {
            this.solution.active = isPublic;
            this.ummClient.update_solution_active({
                solutionId: this.solution.id,
                active: isPublic,
            }).subscribe();
        }
    }

    deleteSolution() {
        if (this.readyToDelete && this.deleteConfirmText === this.solution.name) {
            this.confirmService.ask('确定要删除模型：' + this.solution.name + '？').then((confirm) => {
                if (confirm) {
                    this.ummClient.delete_solution({
                        solutionId: this.solution.id,
                    }).subscribe((res) => {
                        if (res.body['status'] === 'ok') {
                            this.snackBarService.info('成功删除模型...');
                            this.goBack();
                        } else {
                            this.snackBarService.info('删除模型失败：' + res.body['value']);
                        }
                    });
                }
            });
        } else {
            this.snackBarService.warning('确认码不正确，模型未删除...');
        }

    }

    starSolution() {
        if (!this.userLogin) {
            const reason = '你尚未登录，请登录后再关注...';
            const redirectUrl = (window.location.pathname + '@' + this.router.url).replace(/\//g, '$');
            window.location.href = '/#/login/' + redirectUrl + '/' + reason;
        }

        if (this.star) {
            this.ummClient.delete_star({
                starId: this.star.id,
            }).subscribe(
                (res) => {
                    if (res.body['status'] === 'ok') {
                        this.star = null;
                        this.ummClient.update_solution_star_count({
                            solutionId: this.solution.id,
                        }).subscribe();
                        this.solution.starCount--;
                    }
                }
            );
        } else {
            const star = new Star();
            star.targetType = 'AI模型';
            star.targetUuid = this.solutionUuid;
            this.ummClient.create_star({
                star,
            }).subscribe(
                (res) => {
                    if (res.body['status'] === 'ok') {
                        this.loadStar();
                        this.ummClient.update_solution_star_count({
                            solutionId: this.solution.id,
                        }).subscribe();
                        this.solution.starCount++;
                    }
                }
            );
        }
    }

    changeSolutionPicture() {
        const config = {
            width: '800px',
            data: {
                pictureUrl: this.solution.pictureUrl,
            },
        };
        if (window.screen.height < 800) {
            config['height'] = '600px';
        }
        const dialogRef = this.dialog.open(PictureSelectComponent, config);

        dialogRef.afterClosed().subscribe((pictureDataUrl) => {
            if (pictureDataUrl) {
                this.solution.pictureUrl = pictureDataUrl;
                this.ummClient.update_solution_picture_url({
                    solutionId: this.solution.id,
                    pictureUrl: pictureDataUrl,
                }).subscribe((res) => {
                    if (res.body['status'] === 'ok') {
                        this.ummClient.update_deployment_solution_info({
                            deploymentId: this.deployedAbility.id,
                        }).subscribe();
                    }
                });
            }
        });
    }

    loadComments() {
        this.ummClient.get_comments({
            solutionUuid: this.solution.uuid,
            parentUuid: '0',
            page: this.page - 1,
            size: this.itemsPerPage,
            sort: ['id,desc'],
        }).subscribe(
            (res) => {
                if (res.body['status'] === 'ok') {
                    this.totalItems = res.body['value']['total'];
                    this.comments = res.body['value']['results'];
                    this.comments.forEach(
                        (comment) => {
                            this.loadReplyComments(comment);
                        }
                    );
                }
            }
        );
    }

    reloadPage(pageEvent: PageEvent) {
        this.itemsPerPage = pageEvent.pageSize;
        this.page = pageEvent.pageIndex + 1;

        if (this.previousPage !== this.page) {
            this.previousPage = this.page;
            this.loadComments();
        }

        if (this.itemsPerPage !== this.previousItemsPerPage) {
            this.previousItemsPerPage = this.itemsPerPage;
            this.loadComments();
        }
    }

    submitComment(parentUuid: string, level: number) {
        const comment = new Comment();
        comment.uuid = uuid().replace(/-/g, '').toLowerCase();
        comment.solutionUuid = this.solution.uuid;
        comment.parentUuid = parentUuid;
        comment.commentText = this.commentText;
        comment.level = level;

        this.ummClient.create_comment({
            comment,
        }).subscribe(
            (res) => {
                if (res.body['status'] === 'ok') {
                    this.loadComments();
                    this.commentText = '';
                    this.ummClient.update_solution_comment_count({
                        solutionId: this.solution.id,
                    }).subscribe();
                    this.solution.commentCount++;
                }
            }
        );
    }

    submitReplyComment(parentComment: Comment) {
        const comment = new Comment();
        comment.uuid = uuid().replace(/-/g, '').toLowerCase();
        comment.solutionUuid = this.solution.uuid;
        comment.parentUuid = parentComment.uuid;
        comment.commentText = parentComment.replyText;
        comment.level = parentComment.level + 1;

        this.ummClient.create_comment({
            comment,
        }).subscribe(
            (res) => {
                if (res.body['status'] === 'ok') {
                    this.loadReplyComments(parentComment);
                    parentComment.viewReply = true;
                    parentComment.replyText = '';
                    this.toggleReplyComment(parentComment);
                    this.ummClient.update_solution_comment_count({
                        solutionId: this.solution.id,
                    }).subscribe();
                    this.solution.commentCount++;
                }
            }
        );
    }

    toggleReplyComment(comment: Comment) {
        comment.isReplying = !comment.isReplying;
    }

    toggleViewComment(comment: Comment) {
        comment.viewReply = !comment.viewReply;
    }

    loadReplyComments(comment: Comment) {
        this.ummClient.get_comments({
            solutionUuid: this.solution.uuid,
            parentUuid: comment.uuid,
            sort: ['id,desc'],
        }).subscribe(
            (res) => {
                if (res.body['status'] === 'ok') {
                    comment.replyComments = res.body['value']['results'];
                    if (comment.level < 2) {
                        comment.replyComments.forEach(
                            (replyComment) => {
                                this.loadReplyComments(replyComment);
                            }
                        );
                    }
                }
            }
        );
    }

    canDeleteComment(comment: Comment) {
        return (!comment.replyComments || (comment.replyComments.length < 1)
                    && (this.isManager || (this.userLogin === comment.userLogin)));
    }

    deleteComment(comment: Comment) {
        this.confirmService.ask('确定要删帖？').then((confirm) => {
            if (confirm) {
                this.ummClient.delete_comment({
                    commentId: comment.id,
                }).subscribe(
                    (res) => {
                        if (res.body['status'] === 'ok') {
                            this.loadComments();
                            this.ummClient.update_solution_comment_count({
                                solutionId: this.solution.id,
                            }).subscribe();
                            this.solution.commentCount--;
                        }
                    }
                );
            }
        });
    }

    deleteReply(reply: Comment, parent: Comment) {
        this.confirmService.ask('确定要删帖？').then((confirm) => {
            if (confirm) {
                this.ummClient.delete_comment({
                    commentId: reply.id,
                }).subscribe(
                    (res) => {
                        if (res.body['status'] === 'ok') {
                            this.loadReplyComments(parent);
                            this.ummClient.update_solution_comment_count({
                                solutionId: this.solution.id,
                            }).subscribe();
                            this.solution.commentCount--;
                        }
                    }
                );
            }
        });
    }

    deploySolution() {
        this.router.navigate(['/deploy/deploy/' + this.solution.uuid]);
    }

    gotoAbility() {
        window.location.href = this.openAbilityUrl;
    }

    gotoPersonal(authorLogin: string) {
        this.router.navigate(['/personal/' + authorLogin]);
    }

    gotoStargazers() {
        if (this.solution.starCount > 0) {
            this.router.navigate(['/stargazer/' + this.solution.uuid + '/' + this.solution.name]);
        }
    }

}
