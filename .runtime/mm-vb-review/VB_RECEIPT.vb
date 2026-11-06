Imports SAP.Middleware.Connector
Imports System.Data
Imports System.Data.SqlClient
Imports System.Globalization

Public Class Form1
    Private _ccc As RfcDestination

    Dim log As String
    Dim con As New SqlConnection
    Dim cmd As New SqlCommand
    Dim cnt As New SqlCommand
    Dim op1 As New SqlCommand
    Dim reader As SqlDataReader
    Dim readx As SqlDataReader
    Dim itab As New SqlDataAdapter
    Dim iset As New DataSet
    Dim idt As New DataTable
    Dim numrows As Integer

    Dim sqlquery As String
    Dim count As String
    Dim top1 As String

    Dim PSTNG_DATE As String = "yyyyMMdd"
    Dim DOC_DATE As String
    Dim REF_DOC_NO As String
    Dim MATERIAL As String
    Dim PLANT As String
    Dim STGE_LOC As String
    Dim MOVE_TYPE As String
    Dim ENTRY_QNT As Integer
    Dim SUMENTRY_QNT As Integer
    Dim PO_NUMBER As String
    Dim PO_ITEM As String
    Dim MVT_IND As String
    Dim PDS_NO As String
    Dim PDSX As String
    Dim PDSNUM As String
    Dim RECOVERY As String
    Dim SERIALNO As String
    Dim REMARKS As String
    Dim BATCH As String
    Dim INVNO As String
    Dim BACKNO As String

    Dim dt As Date = Date.Today

    Private Sub Form1_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        Try
            Me.Hide()
            Me.Visible = False
[connection string omitted]
            con.Open()
            cmd.Connection = con

            RfcDestinationManager.RegisterDestinationConfiguration(New ECCDestinationConfig)
            _ccc = RfcDestinationManager.GetDestination("PRD")
            Dim repository As RfcRepository = _ccc.Repository

            Dim receipt As IRfcFunction = _ccc.Repository.CreateFunction("ZZBAPI_GOODSMVT_CREATE")
            Dim tab1 As IRfcTable = receipt.GetTable("ZTAB")

            top1 = "SELECT TOP 1 "
            top1 = top1 & "* "
            top1 = top1 & "FROM "
            top1 = top1 & "TT_PURCHASE_RECEIPT_H "
            top1 = top1 & "WHERE TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '0' "
            top1 = top1 & "AND TT_PURCHASE_RECEIPT_H.CHR_PDS_NO LIKE 'D%' "
            top1 = top1 & "ORDER BY TT_PURCHASE_RECEIPT_H.CHR_PDS_NO, TT_PURCHASE_RECEIPT_H.INT_PDS_PROCSEQ ASC "

            op1 = New SqlCommand(top1, con)
            readx = op1.ExecuteReader()
            While readx.Read
                If Not readx.IsDBNull(0) Then
                    PDSX = readx("CHR_PDS_NO")
                End If
            End While

            sqlquery = "SELECT "
            sqlquery = sqlquery & "* "
            sqlquery = sqlquery & "FROM "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H "
            sqlquery = sqlquery & "INNER JOIN "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_L "
            sqlquery = sqlquery & "ON "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H.CHR_PDS_NO = TT_PURCHASE_RECEIPT_L.CHR_PDS_NO AND "
            sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H.INT_PDS_PROCSEQ = TT_PURCHASE_RECEIPT_L.INT_PDS_PROCSEQ AND "
            sqlquery = sqlquery & "(TT_PURCHASE_RECEIPT_H.CHR_UPLOAD is null OR TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '' OR TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '0' )"
            'sqlquery = sqlquery & "WHERE TT_PURCHASE_RECEIPT_H.CHR_PDS_NO LIKE 'D%' "
            sqlquery = sqlquery & "WHERE TT_PURCHASE_RECEIPT_H.CHR_PDS_NO = '" & PDSX & "' "
            sqlquery = sqlquery & "ORDER BY TT_PURCHASE_RECEIPT_H.CHR_PDS_NO, TT_PURCHASE_RECEIPT_H.INT_PDS_PROCSEQ ASC "

            count = "SELECT COUNT(*) FROM "
            count = count & "TT_PURCHASE_RECEIPT_H "
            count = count & "INNER JOIN "
            count = count & "TT_PURCHASE_RECEIPT_L "
            count = count & "ON "
            count = count & "TT_PURCHASE_RECEIPT_H.CHR_PDS_NO = TT_PURCHASE_RECEIPT_L.CHR_PDS_NO AND "
            count = count & "TT_PURCHASE_RECEIPT_H.INT_PDS_PROCSEQ = TT_PURCHASE_RECEIPT_L.INT_PDS_PROCSEQ AND "
            count = count & "(TT_PURCHASE_RECEIPT_H.CHR_UPLOAD is null OR TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '' OR TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '0') "
            'count = count & "WHERE TT_PURCHASE_RECEIPT_H.CHR_PDS_NO LIKE 'D%' "
            count = count & "WHERE TT_PURCHASE_RECEIPT_H.CHR_PDS_NO = '" & PDSX & "' "

            'PSTNG_DATE = dt.ToString("yyyyMMdd")

            readx.Close()
            cmd = New SqlCommand(sqlquery, con)
            cnt = New SqlCommand(count, con)
            numrows = cnt.ExecuteScalar()
            reader = cmd.ExecuteReader
            While reader.Read
                If Not reader.IsDBNull(0) Then

                    DOC_DATE = reader("CHR_CREATE_DATE")
                    PSTNG_DATE = reader("CHR_REQ_DATE")
                    REF_DOC_NO = reader("CHR_PDS_NO")
                    MATERIAL = reader("CHR_PART_NO")
                    ENTRY_QNT = reader("INT_RECQTY")
                    SUMENTRY_QNT = reader("INT_SUM_RECQTY")
                    PO_NUMBER = reader("CHR_PONO_R3")
                    PO_ITEM = reader("CHR_PONO_LINE_R3")
                    PDS_NO = reader("CHR_PDS_NO")
                    RECOVERY = reader("INT_PDS_PROCSEQ")
                    SERIALNO = reader("CHR_SER_NO")
                    REMARKS = reader("CHR_REMARKS")
                    BATCH = reader("CHR_BATCH_NO")
                    INVNO = reader("CHR_INV_NO")
                    BACKNO = reader("CHR_BACK_NO")
                    PDSNUM = numrows & "-" & RTrim(PDS_NO)

                    tab1.Insert()
                    tab1.SetValue("ZMATERIAL", MATERIAL)
                    tab1.SetValue("ZPLANT", "600")
                    tab1.SetValue("ZSTGE_LOC", "WH00")
                    tab1.SetValue("ZMOVE_TYPE", "101")
                    tab1.SetValue("ZMVT_IND", "B")
                    tab1.SetValue("ZENTRY_QNT", ENTRY_QNT)
                    tab1.SetValue("ZSUMENTRY_QNT", SUMENTRY_QNT)
                    tab1.SetValue("ZPO_NUMBER", PO_NUMBER)
                    tab1.SetValue("ZPO_ITEM", PO_ITEM)
                    tab1.SetValue("ZSERIALNO", SERIALNO)
                    tab1.SetValue("ZREMARKS", REMARKS)
                    tab1.SetValue("ZBATCH", BATCH)
                    tab1.SetValue("ZINVNO", INVNO)
                    tab1.SetValue("ZBACKNO", BACKNO)
                    tab1.SetValue("ZCODE", "01")

                    tab1.SetValue("ZPSTNG_DATE", PSTNG_DATE)
                    tab1.SetValue("ZDOC_DATE", DOC_DATE)
                    tab1.SetValue("ZREF_DOC_NO", REF_DOC_NO)

                    tab1.SetValue("ZPDS", PDS_NO)
                    tab1.SetValue("ZRECOVERY", RECOVERY)
                    tab1.SetValue("ZNUMROWS", numrows)
                    tab1.SetValue("ZABLAD", PDSNUM)
                    receipt.Invoke(_ccc)
                End If
            End While
            Me.Close()
            Threading.Thread.Sleep(500)
        Catch ex As Exception
            MessageBox.Show(ex.Message.ToString())
            Me.Close()
        End Try
        Me.Close()
    End Sub
End Class